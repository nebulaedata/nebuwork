package cn.nebulaedata.cccs.nebuwork.backend.api.knowledge;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import com.fasterxml.jackson.databind.*;
import org.apache.http.*;
import org.apache.http.client.config.RequestConfig;
import org.apache.http.client.methods.*;
import org.apache.http.entity.*;
import org.apache.http.impl.client.*;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;
import javax.annotation.PreDestroy;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Function;

/** Bounded REST transport. DNS is validated and pinned for the complete operation. */
@Component
public class KnowledgeRestClient {
    private final ObjectMapper json;private final Environment env;private final KnowledgeNetworkPolicy policy;
    private final Semaphore slots=new Semaphore(8);
    private final ExecutorService dns=new ThreadPoolExecutor(2,4,30,TimeUnit.SECONDS,new ArrayBlockingQueue<Runnable>(16),r->{Thread t=new Thread(r,"knowledge-rest-dns");t.setDaemon(true);return t;},new ThreadPoolExecutor.AbortPolicy());
    private final ScheduledExecutorService timers=Executors.newSingleThreadScheduledExecutor(r->{Thread t=new Thread(r,"knowledge-rest-timeout");t.setDaemon(true);return t;});
    public KnowledgeRestClient(ObjectMapper json,Environment env,KnowledgeNetworkPolicy policy){this.json=json;this.env=env;this.policy=policy;}
    @PreDestroy public void close(){dns.shutdownNow();timers.shutdownNow();}
    public static String normalize(String value){
        URI u=KnowledgeNetworkPolicy.endpoint(value);String s=u.normalize().toASCIIString().replaceAll("/+$","");
        return s.endsWith("/api/v1")?s:s+"/api/v1";
    }
    public static String segment(String value){
        if(value==null||value.isEmpty()||value.equals(".")||value.equals("..")||value.chars().anyMatch(c->c<32||c==127))throw new ApiException(422,"无效远端资源标识");
        try{return URLEncoder.encode(value,"UTF-8").replace("+","%20");}catch(Exception e){throw new IllegalStateException(e);}
    }
    public static String slug(String value){StringJoiner path=new StringJoiner("/");for(String part:value.split("/",-1))path.add(segment(part));return path.toString();}
    public <T>T execute(String endpoint,Map<String,String> headers,Function<Session,T> fn){
        return executeAt(URI.create(normalize(endpoint)),headers,fn);
    }
    /** V101 retrieval has a 90s channel budget plus bounded source resolution. */
    public <T>T executeRetrieval(String endpoint,Map<String,String> headers,Function<Session,T> fn){
        return executeAt(URI.create(normalize(endpoint)),headers,fn,110000);
    }
    /** Large uploads stream from the servlet spool and have their own time budget. */
    public <T>T executeUpload(String endpoint,Map<String,String> headers,Function<Session,T> fn){
        int ms=env.getProperty("nebu.knowledge.upload-timeout-ms",Integer.class,3600000);
        if(ms<1000||ms>3600000)throw new ApiException(503,"知识库上传超时配置范围为 1000–3600000 毫秒");
        return executeAt(URI.create(normalize(endpoint)),headers,fn,ms);
    }
    /** Configuration generation has a separate long budget. */
    public JsonNode generateConfiguration(String endpoint,Map<String,String> headers,JsonNode body){
        return executeAt(URI.create(normalize(endpoint)),headers,s->s.request("POST","/initialization/generate/knowledge-base-config",body),910000);
    }
    /** Only called with a URL obtained from an already authorized upstream task. No service credentials follow it. */
    public Binary downloadReport(String endpoint,String location){
        try{
            URI url=URI.create(normalize(endpoint)+"/").resolve(location);
            if(url.getUserInfo()!=null||url.getRawFragment()!=null)throw new ApiException(422,"下载地址无效");
            URI origin=KnowledgeNetworkPolicy.endpoint(new URI(url.getScheme(),url.getAuthority(),null,null,null).toASCIIString());
            String path=url.getRawPath()+(url.getRawQuery()==null?"":"?"+url.getRawQuery());
            return executeAt(origin,Collections.emptyMap(),s->s.download(path));
        }catch(ApiException e){throw e;}catch(Exception e){throw new ApiException(502,"导入报告下载地址无效");}
    }
    private <T>T executeAt(URI base,Map<String,String> headers,Function<Session,T> fn){
        int ms=env.getProperty("nebu.knowledge.request-timeout-ms",Integer.class,60000);
        if(ms<100||ms>120000)throw new ApiException(503,"知识库超时配置范围为 100–120000 毫秒");
        return executeAt(base,headers,fn,ms);
    }
    private <T>T executeAt(URI base,Map<String,String> headers,Function<Session,T> fn,int ms){
        if(!slots.tryAcquire())throw new ApiException(503,"知识库请求繁忙");
        try{
            long deadline=System.nanoTime()+TimeUnit.MILLISECONDS.toNanos(ms);
            Future<InetAddress[]> lookup=dns.submit(()->InetAddress.getAllByName(base.getHost()));InetAddress[] addresses;
            try{addresses=lookup.get(remaining(deadline),TimeUnit.MILLISECONDS);}finally{lookup.cancel(true);}
            policy.validate(base,addresses);
            try(CloseableHttpClient http=HttpClients.custom().setDnsResolver(host->{if(!base.getHost().replace("[","").replace("]","").equalsIgnoreCase(host.replace("[","").replace("]","")))throw new UnknownHostException("Unexpected host");return addresses.clone();})
                .disableRedirectHandling().disableAutomaticRetries().disableCookieManagement().disableAuthCaching().disableContentCompression().build()){
                return fn.apply(new Session(http,base.toASCIIString(),headers,deadline));
            }
        }catch(ApiException e){throw e;}catch(TimeoutException|InterruptedIOException e){throw new ApiException(504,"知识库请求超时；写操作请核对结果，不要重复提交");}
        catch(InterruptedException e){Thread.currentThread().interrupt();throw new ApiException(503,"知识库请求已中断");}
        catch(Exception e){throw new ApiException(502,"无法连接 Nebulae V100，请检查地址、认证和响应格式");}
        finally{slots.release();}
    }
    private static int remaining(long deadline){long ms=TimeUnit.NANOSECONDS.toMillis(deadline-System.nanoTime());if(ms<=0)throw new ApiException(504,"知识库操作超时，请查询原操作结果");return (int)Math.min(Integer.MAX_VALUE,ms);}
    public static final class Binary {public final byte[] bytes;public final String contentType;public Binary(byte[] bytes,String type){this.bytes=bytes;this.contentType=type;}}
    public class Session {
        private final CloseableHttpClient http;private final String base;private final Map<String,String> headers;private final long deadline;private int consumed;
        Session(CloseableHttpClient http,String base,Map<String,String> headers,long deadline){this.http=http;this.base=base;this.headers=headers;this.deadline=deadline;}
        public JsonNode request(String method,String path,JsonNode body){
            try{
                HttpEntity entity=body==null?null:new StringEntity(json.writeValueAsString(body),ContentType.APPLICATION_JSON);
                Binary raw=exchange(method,path,entity,8*1024*1024,false);
                if(raw.bytes.length==0)return json.createObjectNode();
                JsonNode result=json.readTree(raw.bytes);
                if(result==null||(!result.isContainerNode()))throw new ApiException(502,"知识库返回了无效 JSON");
                if(result.has("success")&&!result.path("success").asBoolean())throw new ApiException(502,"知识库未完成操作，请查看远端处理状态");
                return result;
            }catch(ApiException e){throw e;}catch(Exception e){throw new ApiException(502,"知识库响应格式无效");}
        }
        public JsonNode upload(String path,MultipartFile file,String filename){return uploadFile(path,file,filename,false);}
        public JsonNode uploadV101(String path,MultipartFile file,String filename){return uploadFile(path,file,filename,true);}
        private JsonNode uploadFile(String path,MultipartFile file,String filename,boolean v101){
            String normalized=filename==null?null:filename.replace('\\','/');
            String basename=normalized==null?null:normalized.substring(normalized.lastIndexOf('/')+1);
            KnowledgeUpload.validate(file,basename,normalized!=null&&normalized.contains("/")?normalized:null);
            String boundary="nkb-"+UUID.randomUUID();
            byte[] head=("--"+boundary+"\r\nContent-Disposition: form-data; name=\""+(v101?"relative_path":"fileName")+"\"\r\n\r\n"+normalized+"\r\n--"+boundary+"\r\nContent-Disposition: form-data; name=\"file\"; filename=\""+basename+"\"\r\nContent-Type: application/octet-stream\r\n\r\n").getBytes(StandardCharsets.UTF_8);
            byte[] tail=("\r\n--"+boundary+"--\r\n").getBytes(StandardCharsets.UTF_8);
            try(InputStream source=file.getInputStream();InputStream stream=new SequenceInputStream(Collections.enumeration(Arrays.asList(new ByteArrayInputStream(head),source,new ByteArrayInputStream(tail))))){
                Binary raw=exchange("POST",path,new InputStreamEntity(stream,head.length+file.getSize()+tail.length,ContentType.create("multipart/form-data").withParameters(new org.apache.http.message.BasicNameValuePair("boundary",boundary))),8*1024*1024,false,true);
                JsonNode result=json.readTree(raw.bytes);if(result==null||result.has("success")&&!result.path("success").asBoolean())throw new ApiException(502,"文件上传未成功");return result;
            }catch(ApiException e){throw e;}catch(Exception e){throw new ApiException(502,"文件上传结果不确定，请核对文档列表");}
        }
        public Binary download(String path){return exchange("GET",path,null,100*1024*1024,true);}
        public JsonNode rawJSON(String method,String path,InputStream body,long length,String contentType){
            try{Binary raw=exchange(method,path,body==null?null:new InputStreamEntity(body,length,ContentType.parse(contentType)),8*1024*1024,false);return raw.bytes.length==0?json.createObjectNode():json.readTree(raw.bytes);}catch(ApiException e){throw e;}catch(IOException e){throw new ApiException(502,"V101 响应无效，请核对原操作");}
        }
        public JsonNode multipart(String method,String path,Collection<javax.servlet.http.Part> parts){
            String boundary="nw-v101-"+UUID.randomUUID();List<InputStream> streams=new ArrayList<>();
            try{for(javax.servlet.http.Part part:parts){String name=part.getName(),file=part.getSubmittedFileName();if(name==null||!name.matches("[A-Za-z0-9_-]{1,100}"))throw new ApiException(422,"无效上传字段");if(file!=null){file=file.replace('\\','/');file=file.substring(file.lastIndexOf('/')+1);if(file.indexOf('\r')>=0||file.indexOf('\n')>=0||file.indexOf('"')>=0)throw new ApiException(422,"无效上传文件名");}String header="--"+boundary+"\r\nContent-Disposition: form-data; name=\""+name+"\""+(file==null?"":"; filename=\""+file+"\"")+"\r\nContent-Type: application/octet-stream\r\n\r\n";streams.add(new ByteArrayInputStream(header.getBytes(StandardCharsets.UTF_8)));streams.add(part.getInputStream());streams.add(new ByteArrayInputStream("\r\n".getBytes(StandardCharsets.UTF_8)));}streams.add(new ByteArrayInputStream(("--"+boundary+"--\r\n").getBytes(StandardCharsets.UTF_8)));try(InputStream input=new SequenceInputStream(Collections.enumeration(streams))){return rawJSON(method,path,input,-1,"multipart/form-data; boundary="+boundary);}}catch(IOException e){throw new ApiException(502,"上传结果待核对");}finally{for(InputStream stream:streams)try{stream.close();}catch(IOException ignored){}}
        }
        /** Only the V101 route allowlist calls this transport; never accepts a caller URL. */
        public void forward(String method,String path,boolean root,InputStream body,long length,String type,Map<String,String> extra,javax.servlet.http.HttpServletResponse output,java.util.function.BooleanSupplier authorized){
            if(!path.startsWith("/")||path.startsWith("//")||path.contains("#")||path.contains(".."))throw new ApiException(422,"无效 V101 资源路径");
            HttpEntityEnclosingRequestBase request=new HttpEntityEnclosingRequestBase(){@Override public String getMethod(){return method;}};
            request.setURI(URI.create((root?base.substring(0,base.length()-7):base)+path));headers.forEach(request::setHeader);extra.forEach(request::setHeader);
            if(body!=null)request.setEntity(new InputStreamEntity(body,length,type==null?ContentType.APPLICATION_OCTET_STREAM:ContentType.parse(type)));
            request.setConfig(RequestConfig.custom().setConnectTimeout(10000).setSocketTimeout(120000).setConnectionRequestTimeout(10000).build());
            try(CloseableHttpResponse response=http.execute(request)){
                output.setStatus(response.getStatusLine().getStatusCode());for(String h:Arrays.asList("Content-Type","Content-Length","Content-Range","Accept-Ranges","ETag","Content-Disposition"))if(response.containsHeader(h))output.setHeader(h,response.getFirstHeader(h).getValue());
                output.setHeader("Cache-Control","private, no-store");output.setHeader("X-Content-Type-Options","nosniff");output.setHeader("X-Accel-Buffering","no");
                if(response.getEntity()==null)return;long total=0,checked=0;try(InputStream input=response.getEntity().getContent()){byte[] buffer=new byte[16384];int n;while((n=input.read(buffer))!=-1){total+=n;if(total>2147483648L)throw new ApiException(413,"V101 文件超过 2 GiB");long now=System.currentTimeMillis();if(now-checked>1000){if(!authorized.getAsBoolean())return;checked=now;}output.getOutputStream().write(buffer,0,n);output.flushBuffer();}}
            }catch(org.apache.catalina.connector.ClientAbortException closed){/* Closing the reader closes its upstream stream. */}catch(IOException e){throw new ApiException(502,"V101 资源传输中断");}finally{request.abort();}
        }
        public Binary rootDownload(String path){
            if(!path.matches("/(?:assets/[A-Za-z0-9_.-]+|pdfjs/[A-Za-z0-9_./-]+|)")||path.contains(".."))throw new ApiException(422,"无效 V101 静态资源");
            try(CloseableHttpResponse response=http.execute(new HttpGet(base.substring(0,base.length()-7)+path))){if(response.getStatusLine().getStatusCode()!=200)throw new ApiException(404,"V101 静态文件不存在");HttpEntity entity=response.getEntity();byte[] bytes=org.apache.http.util.EntityUtils.toByteArray(entity);if(bytes.length>32*1024*1024)throw new ApiException(413,"静态资源超出预算");return new Binary(bytes,entity.getContentType()==null?"application/octet-stream":entity.getContentType().getValue());}catch(IOException e){throw new ApiException(502,"V101 静态文件读取失败");}
        }
        /** Preview-only stream; existing JSON/report limits are not relaxed. */
        public void streamPreview(String path,String range,javax.servlet.http.HttpServletResponse output){
            if(!path.startsWith("/knowledge/")||!path.endsWith("/preview"))throw new ApiException(422,"无效原文路径");HttpGet request=new HttpGet(base+path);headers.forEach(request::setHeader);if(range!=null)request.setHeader("Range",range);request.setConfig(RequestConfig.custom().setConnectTimeout(10000).setConnectionRequestTimeout(10000).setSocketTimeout(120000).build());
            try(CloseableHttpResponse response=http.execute(request)){
                int status=response.getStatusLine().getStatusCode();if(status!=200&&status!=206&&status!=416)throw new ApiException(status==404?404:502,"原文件读取失败");output.setStatus(status);for(String h:Arrays.asList("Content-Type","Content-Length","Content-Range","Accept-Ranges","ETag"))if(response.containsHeader(h))output.setHeader(h,response.getFirstHeader(h).getValue());output.setHeader("Content-Disposition","inline");output.setHeader("Cache-Control","private, no-store");output.setHeader("X-Content-Type-Options","nosniff");
                if(response.getEntity()==null)return;long count=0;try(InputStream in=response.getEntity().getContent()){byte[] buffer=new byte[65536];int n;while((n=in.read(buffer))!=-1){count+=n;if(count>2147483648L)throw new ApiException(413,"原文件超过 2048 MiB");output.getOutputStream().write(buffer,0,n);}}
            }catch(ApiException e){throw e;}catch(org.apache.catalina.connector.ClientAbortException closed){/* Reader closed: try-with-resources cancels the upstream. */}catch(IOException e){throw new ApiException(502,"原文件传输中断");}
        }
        private String validationMessage(int status,HttpEntity entity){
            String fallback="远端知识库拒绝操作（HTTP "+status+"），请检查参数和远端配置";
            if(entity==null)return fallback;
            // Translate known public error codes only. Upstream details may contain credentials or URLs.
            try(InputStream input=entity.getContent()){
                ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buffer=new byte[1024];int n;
                while((n=input.read(buffer))!=-1){remaining(deadline);if(out.size()+n>16384)return fallback;out.write(buffer,0,n);}
                JsonNode response=json.readTree(out.toByteArray());int code=response==null?0:response.path("error").path("code").asInt();
                if(code==2200)return "远端向量存储实例无效或不属于当前空间，请选择空间默认向量存储或有效实例";
                if(code==2201)return "远端向量存储暂不可用，请联系管理员检查该实例的连接配置";
                String reason=response==null?"":response.path("error").path("details").path("generation_reason").asText();
                if("model_failed".equals(reason))return "AI 配置生成模型调用失败，请管理员检查模型服务后重试";
                if("invalid_response".equals(reason))return "AI 返回的业务配置不符合结构要求，请重试生成或更换生成模型";
                if("timeout".equals(reason))return "AI 配置生成超时，可以重试生成；尚未创建知识库";
            }catch(Exception ignored){/* Keep the generic message for malformed or oversized upstream errors. */}
            return fallback;
        }
        private Binary duplicateReceipt(HttpEntity entity){
            if(entity==null)return null;
            try(InputStream input=entity.getContent()){
                ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buffer=new byte[1024];int n;
                while((n=input.read(buffer))!=-1){remaining(deadline);if(out.size()+n>16384)return null;out.write(buffer,0,n);}
                JsonNode raw=json.readTree(out.toByteArray());
                if(raw==null||!"duplicate_file".equals(raw.path("code").asText())||raw.path("data").path("id").asText().isEmpty()||raw.path("data").path("knowledge_base_id").asText().isEmpty())return null;
                com.fasterxml.jackson.databind.node.ObjectNode result=json.createObjectNode();result.put("uploadOutcome","duplicate");
                com.fasterxml.jackson.databind.node.ObjectNode document=result.putObject("data");
                for(String key:Arrays.asList("id","knowledge_base_id","file_name","folder_path","parse_status"))document.put(key,raw.path("data").path(key).asText());
                return new Binary(json.writeValueAsBytes(result),"application/json");
            }catch(ApiException e){throw e;}catch(Exception e){return null;}
        }
        private Binary exchange(String method,String path,HttpEntity entity,int limit,boolean binary){return exchange(method,path,entity,limit,binary,false);}
        private Binary exchange(String method,String path,HttpEntity entity,int limit,boolean binary,boolean upload){
            if(!path.startsWith("/")||path.startsWith("//")||path.contains("#"))throw new ApiException(422,"无效知识库请求路径");
            for(int attempt=0;attempt<3;attempt++){
                final String verb=method;
                HttpEntityEnclosingRequestBase request=new HttpEntityEnclosingRequestBase(){@Override public String getMethod(){return verb;}};
                request.setURI(URI.create(base+path));request.setEntity(entity);
                int ms=remaining(deadline);request.setConfig(RequestConfig.custom().setConnectTimeout(ms).setSocketTimeout(ms).setConnectionRequestTimeout(ms).build());
                headers.forEach(request::setHeader);request.setHeader("Accept",binary?"*/*":"application/json");
                ScheduledFuture<?> cancel=timers.schedule(request::abort,ms,TimeUnit.MILLISECONDS);
                try(CloseableHttpResponse response=http.execute(request)){
                    int status=response.getStatusLine().getStatusCode();
                    if((status==429||status==503)&&"GET".equals(method)&&attempt<2){Thread.sleep(Math.min(200L*(attempt+1),remaining(deadline)));continue;}
                    if(status<200||status>=300){
                        if(status==409&&upload){Binary duplicate=duplicateReceipt(response.getEntity());if(duplicate!=null)return duplicate;}
                        if(status==401||status==403)throw new ApiException(502,"远端认证或权限不足，请联系管理员检查 API Key 和知识库范围（"+status+"）");
                        if(status==404)throw new ApiException(404,"远端资源不存在、不可见或此版本不支持该接口");
                        if(status==409)throw new ApiException(409,"远端内容已存在或发生冲突，请刷新核对后继续");
                        if(status==429)throw new ApiException(503,"远端知识库限流，请稍后重试");
                        if(status==400||status==422)throw new ApiException(422,validationMessage(status,response.getEntity()));
                        if(status>=500&&path.equals("/initialization/generate/knowledge-base-config"))throw new ApiException(502,validationMessage(status,response.getEntity()));
                        throw new ApiException(502,"远端知识库拒绝操作（HTTP "+status+"），请检查参数和远端配置");
                    }
                    ByteArrayOutputStream out=new ByteArrayOutputStream();HttpEntity result=response.getEntity();
                    if(result!=null)try(InputStream input=result.getContent()){byte[] buffer=new byte[8192];int n;while((n=input.read(buffer))!=-1){remaining(deadline);if(out.size()+n>limit||!binary&&consumed+n>8*1024*1024)throw new ApiException(502,"知识库响应超过大小限制，请分页读取");out.write(buffer,0,n);if(!binary)consumed+=n;}}
                    Header type=response.getFirstHeader("Content-Type");return new Binary(out.toByteArray(),type==null?"application/octet-stream":type.getValue());
                }catch(ApiException e){throw e;}catch(InterruptedException e){Thread.currentThread().interrupt();throw new ApiException(503,"知识库请求已中断");}
                catch(Exception e){throw new ApiException(504,"知识库请求未完成；写操作结果可能已生效，请核对后继续");}
                finally{cancel.cancel(false);request.releaseConnection();}
            }
            throw new ApiException(503,"知识库暂不可用");
        }
    }
}
