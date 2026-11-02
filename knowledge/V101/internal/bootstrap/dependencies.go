package bootstrap

import (
	"context"
	"errors"
	"github.com/google/uuid"
	"github.com/neo4j/neo4j-go-driver/v6/neo4j"
	graphconfig "github.com/neo4j/neo4j-go-driver/v6/neo4j/config"
	"github.com/redis/go-redis/v9"
	"nebulaekno/internal/config"
	"net/url"
	"strings"
	"time"
)

func connectGraph(ctx context.Context, c config.Config) (neo4j.Driver, error) {
	u, _ := url.Parse(c.Neo4jURL)
	user := u.User.Username()
	password, _ := u.User.Password()
	u.User = nil
	d, e := neo4j.NewDriver(u.String(), neo4j.BasicAuth(user, password, ""), func(o *graphconfig.Config) {
		o.SocketConnectTimeout = c.ConnectTimeout
		o.MaxTransactionRetryTime = c.ConnectWindow
	})
	if e != nil {
		return nil, config.Fail("INVALID_CONNECTION_URL", "neo4j", "无法创建图数据库驱动")
	}
	if e = d.VerifyConnectivity(ctx); e != nil {
		d.Close(ctx)
		return nil, graphError(e)
	}
	return d, nil
}
func graphError(e error) error {
	var n *neo4j.Neo4jError
	if errors.As(e, &n) {
		if strings.Contains(n.Code, "Security") {
			return config.Fail("AUTH_FAILED", "neo4j", "图数据库认证或权限检查失败")
		}
		if strings.Contains(n.Code, "Procedure") {
			return config.Fail("GRAPH_PROCEDURE_UNAVAILABLE", "neo4j", "APOC Core 过程缺失或不可执行")
		}
		return config.Fail("GRAPH_OPERATION_FAILED", "neo4j", "图数据库操作失败: "+n.Code)
	}
	return &config.Error{Code: "DEPENDENCY_UNREACHABLE", Component: "neo4j", Message: "图数据库连接不可用", Retryable: true}
}
func GraphQuery(ctx context.Context, d neo4j.Driver, q string, p map[string]any) (*neo4j.EagerResult, error) {
	return neo4j.ExecuteQuery(ctx, d, q, p, neo4j.EagerResultTransformer, neo4j.ExecuteQueryWithDatabase("neo4j"))
}
func checkGraph(ctx context.Context, d neo4j.Driver) error {
	r, e := GraphQuery(ctx, d, "CALL dbms.components() YIELD versions, edition RETURN versions[0] AS version, edition", nil)
	if e != nil {
		return graphError(e)
	}
	if len(r.Records) != 1 {
		return config.Fail("GRAPH_VERSION_UNSUPPORTED", "neo4j", "无法确认图数据库版本")
	}
	v, _ := r.Records[0].Get("version")
	edition, _ := r.Records[0].Get("edition")
	if !strings.HasPrefix(v.(string), "5.26.") || edition != "community" {
		return config.Fail("GRAPH_VERSION_UNSUPPORTED", "neo4j", "需要 Neo4j Community 5.26 LTS")
	}
	r, e = GraphQuery(ctx, d, "SHOW PROCEDURES YIELD name WHERE name IN $names RETURN name", map[string]any{"names": []string{"apoc.merge.node", "apoc.merge.relationship", "apoc.periodic.iterate"}})
	if e != nil {
		return graphError(e)
	}
	if len(r.Records) != 3 {
		return config.Fail("GRAPH_PROCEDURE_UNAVAILABLE", "neo4j", "需要 APOC Core 的 merge 和 periodic.iterate 过程")
	}
	probe := uuid.NewString()
	defer func() {
		c, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _ = GraphQuery(c, d, "MATCH (n:NebulaeKnoProbe {probe:$probe}) DETACH DELETE n", map[string]any{"probe": probe})
	}()
	_, e = GraphQuery(ctx, d, `CALL apoc.merge.node(['NebulaeKnoProbe'],{probe:$probe,part:'a'},{},{}) YIELD node AS a
CALL apoc.merge.node(['NebulaeKnoProbe'],{probe:$probe,part:'b'},{},{}) YIELD node AS b
CALL apoc.merge.relationship(a,'NEBULAEKNO_PROBE',{probe:$probe},{},b,{}) YIELD rel
RETURN apoc.coll.union([1],[2]) AS values`, map[string]any{"probe": probe})
	if e != nil {
		return graphError(e)
	}
	periodic, e := GraphQuery(ctx, d, "CALL apoc.periodic.iterate('RETURN 1 AS x','RETURN x',{batchSize:1,parallel:false}) YIELD failedOperations RETURN failedOperations", nil)
	if e != nil {
		return graphError(e)
	}
	if len(periodic.Records) != 1 {
		return config.Fail("GRAPH_PROCEDURE_UNAVAILABLE", "neo4j", "APOC 批处理未返回结果")
	}
	failed, _ := periodic.Records[0].Get("failedOperations")
	if failed != int64(0) {
		return config.Fail("GRAPH_PROCEDURE_UNAVAILABLE", "neo4j", "APOC 批处理执行失败")
	}
	if _, e = GraphQuery(ctx, d, "MATCH (n:NebulaeKnoProbe {probe:$probe}) DETACH DELETE n", map[string]any{"probe": probe}); e != nil {
		return graphError(e)
	}
	return nil
}
func initGraph(ctx context.Context, d neo4j.Driver, id Identity) error {
	previous, err := GraphQuery(ctx, d, "MATCH (n:NebulaeKnoInstallation {slot:'primary'}) RETURN n.id AS id,n.schema_version AS version", nil)
	if err != nil {
		return graphError(err)
	}
	if len(previous.Records) > 0 {
		old, _ := previous.Records[0].Get("id")
		version, _ := previous.Records[0].Get("version")
		if old != id.ID || version != int64(1) {
			return config.Fail("INSTALLATION_IDENTITY_MISMATCH", "neo4j", "图数据库属于另一安装或结构版本不匹配")
		}
	}
	constraints := map[string]string{
		"nebulaekno_installation": "CREATE CONSTRAINT nebulaekno_installation IF NOT EXISTS FOR (n:NebulaeKnoInstallation) REQUIRE n.slot IS UNIQUE",
		"nebulaekno_entity":       "CREATE CONSTRAINT nebulaekno_entity IF NOT EXISTS FOR (n:NebulaeKnoEntity) REQUIRE (n.installation_id,n.kb_id,n.name) IS UNIQUE",
	}
	for _, q := range constraints {
		if _, e := GraphQuery(ctx, d, q, nil); e != nil {
			return graphError(e)
		}
	}
	r, e := GraphQuery(ctx, d, "SHOW CONSTRAINTS YIELD name,type,labelsOrTypes,properties WHERE name STARTS WITH 'nebulaekno_' RETURN name,type,labelsOrTypes,properties", nil)
	if e != nil {
		return graphError(e)
	}
	for _, row := range r.Records {
		name, _ := row.Get("name")
		typ, _ := row.Get("type")
		labels, _ := row.Get("labelsOrTypes")
		props, _ := row.Get("properties")
		wantLabel := "NebulaeKnoInstallation"
		wantProps := "slot"
		if name == "nebulaekno_entity" {
			wantLabel = "NebulaeKnoEntity"
			wantProps = "installation_id,kb_id,name"
		}
		ls := []string{}
		ps := []string{}
		for _, x := range labels.([]any) {
			ls = append(ls, x.(string))
		}
		for _, x := range props.([]any) {
			ps = append(ps, x.(string))
		}
		if typ != "UNIQUENESS" || strings.Join(ls, ",") != wantLabel || strings.Join(ps, ",") != wantProps {
			return config.Fail("GRAPH_SCHEMA_CONFLICT", "neo4j", "已有同名约束定义不匹配")
		}
	}
	r, e = GraphQuery(ctx, d, "MERGE (n:NebulaeKnoInstallation {slot:'primary'}) ON CREATE SET n.id=$id,n.schema_version=1 RETURN n.id AS id,n.schema_version AS version", map[string]any{"id": id.ID})
	if e != nil {
		return graphError(e)
	}
	existing, _ := r.Records[0].Get("id")
	ver, _ := r.Records[0].Get("version")
	if existing != id.ID || ver != int64(1) {
		return config.Fail("INSTALLATION_IDENTITY_MISMATCH", "neo4j", "图数据库属于另一安装或结构版本不匹配")
	}
	_, e = GraphQuery(ctx, d, "CALL db.awaitIndexes(60)", nil)
	if e != nil {
		return graphError(e)
	}
	return nil
}
func connectRedis(ctx context.Context, c config.Config) (*redis.Client, error) {
	o, e := redis.ParseURL(c.RedisURL)
	if e != nil {
		return nil, config.Fail("INVALID_CONNECTION_URL", "redis", "Redis URL 参数无效")
	}
	o.DialTimeout = c.ConnectTimeout
	o.ReadTimeout = c.ConnectTimeout
	o.WriteTimeout = c.ConnectTimeout
	o.MaxRetries = 0
	r := redis.NewClient(o)
	if e = r.Ping(ctx).Err(); e != nil {
		r.Close()
		return nil, redisError(e)
	}
	return r, nil
}
func redisError(e error) error {
	if strings.Contains(e.Error(), "WRONGPASS") || strings.Contains(e.Error(), "NOAUTH") {
		return config.Fail("AUTH_FAILED", "redis", "Redis 认证失败")
	}
	if strings.Contains(e.Error(), "NOPERM") || strings.Contains(e.Error(), "unknown command") {
		return config.Fail("REDIS_CAPABILITY_MISSING", "redis", "Redis 账号缺少诊断、队列或脚本权限")
	}
	return &config.Error{Code: "DEPENDENCY_UNREACHABLE", Component: "redis", Message: "Redis 操作不可用", Retryable: true}
}
func checkRedis(ctx context.Context, r *redis.Client, prefix string) error {
	info, e := r.Info(ctx, "server").Result()
	if e != nil {
		return redisError(e)
	}
	if !strings.Contains(info, "redis_version:7.4.") {
		return config.Fail("REDIS_VERSION_UNSUPPORTED", "redis", "需要 Redis 7.4")
	}
	values, e := r.ConfigGet(ctx, "appendonly").Result()
	if e != nil {
		return redisError(e)
	}
	policy, e := r.ConfigGet(ctx, "maxmemory-policy").Result()
	if e != nil {
		return redisError(e)
	}
	values["maxmemory-policy"] = policy["maxmemory-policy"]
	if values["appendonly"] != "yes" || values["maxmemory-policy"] != "noeviction" {
		return config.Fail("REDIS_CAPABILITY_MISSING", "redis", "部署端必须开启 AOF 并设置 maxmemory-policy=noeviction")
	}
	key := prefix + "probe:" + uuid.NewString()
	defer func() {
		c, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		r.Del(c, key)
	}()
	value, e := r.Eval(ctx, `redis.call('LPUSH',KEYS[1],ARGV[1]); redis.call('EXPIRE',KEYS[1],30); return redis.call('RPOP',KEYS[1])`, []string{key}, "nebulaekno").Text()
	if e != nil {
		return redisError(e)
	}
	if value != "nebulaekno" {
		return config.Fail("REDIS_CAPABILITY_MISSING", "redis", "队列脚本读写探针失败")
	}
	return nil
}
