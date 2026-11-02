package config

import "testing"

func TestExtractionConfigDoesNotRequireGraph(t *testing.T) {
	env := map[string]string{
		"NEBULAEKNO_DATABASE_URL": "postgresql://user:password@database:5432/nebulaekno",
		"NEBULAEKNO_REDIS_URL":    "redis://redis:6379/0",
	}
	c, err := ParseExtraction(func(key string) string { return env[key] })
	if err != nil {
		t.Fatal(err)
	}
	if c.Neo4jURL != "" || c.Port != 8082 || c.MainAPIURL != "http://app:8080" {
		t.Fatalf("wrong extraction config: %+v", c)
	}
	if _, err = Parse(func(key string) string { return env[key] }); err == nil {
		t.Fatal("main app graph requirement changed")
	}
}
