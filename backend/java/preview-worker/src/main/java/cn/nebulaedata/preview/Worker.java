package cn.nebulaedata.preview;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.*;
import java.net.http.*;
import java.io.*;
import java.nio.file.*;
import java.security.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

/** A standalone conversion worker; it cannot call models or modify business files. */
public final class Worker {
    private final long timeoutMs=positive("PREVIEW_TIMEOUT_MS",3600000L),scratchBytes=positive("PREVIEW_SCRATCH_BYTES",64L*1024*1024*1024);
    private static long positive(String name,long fallback){long value=Long.parseLong(System.getenv().getOrDefault(name,Long.toString(fallback)));if(value<=0)throw new IllegalArgumentException(name+" must be positive");return value;}
    private final String base=System.getenv().getOrDefault("PREVIEW_API_URL","http://127.0.0.1:42020/nwaa")+"/internal/file-preview";
    private final String secret=System.getenv().getOrDefault("PREVIEW_WORKER_KEY","");
    private final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).followRedirects(HttpClient.Redirect.NEVER).build();
    private final ObjectMapper json=Converter.JSON;
    private String id,lease;private final AtomicReference<String> stage=new AtomicReference<>("读取原文件");
    private HttpRequest.Builder request(String path){HttpRequest.Builder b=HttpRequest.newBuilder(URI.create(base+path)).timeout(Duration.ofMinutes(60)).header("Authorization","Bearer "+secret);if(lease!=null)b.header("X-Preview-Lease",lease);return b;}
    private JsonNode call(String path,JsonNode body)throws Exception{HttpRequest.Builder r=request(path).timeout(Duration.ofSeconds(30));if(body==null)r.GET();else r.header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(body.toString()));HttpResponse<String> response=http.send(r.build(),HttpResponse.BodyHandlers.ofString());if(response.statusCode()<200||response.statusCode()>299)throw new IOException("预览服务请求失败（"+response.statusCode()+"）");return response.body().isBlank()?json.nullNode():json.readTree(response.body());}
    private String job(){return "/jobs/"+id;}
    private void upload(Path file)throws Exception{
        long size=Files.size(file);JsonNode transfer=call(job()+"/outputs",json.createObjectNode().put("name",file.getFileName().toString()).put("size",size));String upload=transfer.path("id").asText(),path=job()+"/uploads/"+upload;int partSize=transfer.path("partSize").asInt(16*1024*1024);
        try(InputStream in=Files.newInputStream(file)){long offset=0;int number=1;do{int length=(int)Math.min(partSize,size-offset);byte[] bytes=in.readNBytes(length);if(bytes.length!=length)throw new EOFException();String digest=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));HttpRequest r=request(path+"/parts/"+number).header("Content-Type","application/octet-stream").header("X-Part-Sha256",digest).POST(HttpRequest.BodyPublishers.ofByteArray(bytes)).build();HttpResponse<String> response=http.send(r,HttpResponse.BodyHandlers.ofString());if(response.statusCode()!=200)throw new IOException("预览输出分块上传失败");offset+=length;number++;}while(offset<size);}
        JsonNode status=call(path+"/complete",json.createObjectNode());while(!"complete".equals(status.path("status").asText())){if(Arrays.asList("failed","cancelled","expired").contains(status.path("status").asText()))throw new IOException("预览输出校验失败");Thread.sleep(1000);status=call(path,null);}
    }
    private void process(JsonNode job)throws Exception{
        id=job.path("id").asText();lease=job.path("lease").asText();stage.set("读取原文件");Path root=Path.of(System.getenv().getOrDefault("PREVIEW_TEMP_DIR","/tmp/nebu-preview"));Files.createDirectories(root);Path dir=Files.createTempDirectory(root,"job-");Thread thread=Thread.currentThread();AtomicBoolean lost=new AtomicBoolean(),finished=new AtomicBoolean();AtomicReference<InputStream> activeInput=new AtomicReference<>();long started=System.nanoTime();
        ScheduledExecutorService timer=Executors.newSingleThreadScheduledExecutor();timer.scheduleAtFixedRate(()->{if(finished.get())return;try{if(System.nanoTime()-started>TimeUnit.MILLISECONDS.toNanos(timeoutMs))throw new IOException("处理超过配置时间限制");call(job()+"/heartbeat",json.createObjectNode().put("stage",stage.get()));try(var paths=Files.walk(dir)){long bytes=paths.filter(Files::isRegularFile).mapToLong(p->{try{return Files.size(p);}catch(IOException e){return 0;}}).sum();if(bytes>scratchBytes)throw new IOException("处理超过临时磁盘容量限制");}}catch(Exception e){if(!finished.get()){try{call(job()+"/finish",json.createObjectNode().put("error",e instanceof IOException?e.getMessage():"预览任务租约已失效"));}catch(Exception ignored){}lost.set(true);try{InputStream in=activeInput.get();if(in!=null)in.close();}catch(IOException ignored){}thread.interrupt();}}},10,15,TimeUnit.SECONDS);
        try{
            JsonNode metadata=job.path("metadata");String name=metadata.path("name").asText(),ext=metadata.path("fileType").asText("");if(ext.isBlank())ext=name.contains(".")?name.substring(name.lastIndexOf('.')+1).toLowerCase(Locale.ROOT):"";Path source=dir.resolve("source."+ext);MessageDigest sha=MessageDigest.getInstance("SHA-256"),md5=MessageDigest.getInstance("MD5");long count=0;
            HttpResponse<InputStream> response=http.send(request(job()+"/input").GET().build(),HttpResponse.BodyHandlers.ofInputStream());if(response.statusCode()!=200){response.body().close();throw new IOException("原文件读取失败");}
            activeInput.set(response.body());try(InputStream in=response.body();OutputStream out=Files.newOutputStream(source)){byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1){count+=n;if(count>2147483648L)throw new IOException("原文件超过 2048 MiB");sha.update(b,0,n);md5.update(b,0,n);out.write(b,0,n);}}finally{activeInput.set(null);}
            if(metadata.path("size").asLong(-1)>=0&&count!=metadata.path("size").asLong())throw new IOException("原文件传输不完整");String digest=HexFormat.of().formatHex(sha.digest()),legacy=HexFormat.of().formatHex(md5.digest()),expected=job.path("expectedHash").asText();if(!expected.isEmpty()&&!expected.equalsIgnoreCase(digest)&&!expected.equalsIgnoreCase(legacy))throw new IOException("原文件指纹已变化");
            stage.set("解析文件");Converter.Result result=Converter.convert(source,ext,dir,stage::set);stage.set("保存预览版本");for(Path output:result.outputs())upload(output);call(job()+"/finish",json.createObjectNode().put("sourceSha256",digest).set("manifest",result.manifest()));
        }catch(Exception e){Thread.interrupted();if(!lost.get())try{call(job()+"/finish",json.createObjectNode().put("error",e instanceof IOException?e.getMessage():"文件解析失败，文件损坏、加密或格式不受支持"));}catch(Exception ignored){}System.err.println("Preview failed: "+id+" ("+e.getClass().getSimpleName()+")");}
        finally{finished.set(true);timer.shutdownNow();Thread.interrupted();try(var paths=Files.walk(dir)){for(Path p:paths.sorted(Comparator.reverseOrder()).toList())Files.deleteIfExists(p);}id=null;lease=null;}
    }
    public void run()throws Exception{
        if(secret.length()<32)throw new IllegalArgumentException("PREVIEW_WORKER_KEY must contain at least 32 characters");
        Path root=Path.of(System.getenv().getOrDefault("PREVIEW_TEMP_DIR","/tmp/nebu-preview"));Files.createDirectories(root);
        // Each instance owns its scratch volume. The OS releases this lock after a crash.
        try(var channel=java.nio.channels.FileChannel.open(root.resolve(".worker.lock"),StandardOpenOption.CREATE,StandardOpenOption.WRITE);var lock=channel.tryLock()){
            if(lock==null)throw new IOException("临时磁盘已被其他预览 Worker 使用");
            try(var abandoned=Files.newDirectoryStream(root,"job-*")){for(Path dir:abandoned)try(var paths=Files.walk(dir)){for(Path file:paths.sorted(Comparator.reverseOrder()).toList())Files.deleteIfExists(file);}}
            while(!Thread.currentThread().isInterrupted()){try{JsonNode job=call("/claim",json.createObjectNode());if(!job.isNull())process(job);else Thread.sleep(2000);}catch(InterruptedException e){Thread.currentThread().interrupt();}catch(Exception e){System.err.println("Preview worker waiting for API");Thread.sleep(5000);}}
        }
    }
    public static void main(String[] args)throws Exception{new Worker().run();}
}
