package cn.nebulaedata.cccs.nebuwork.backend.api.common;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import java.util.Map;

@RestControllerAdvice
public class ApiErrors {
    private static final Logger LOG=LoggerFactory.getLogger(ApiErrors.class);
    @ExceptionHandler(ApiException.class)
    public ResponseEntity<Map<String,Object>> api(ApiException e) {
        return ResponseEntity.status(e.status).body(ApiSupport.error(e.status,e.getMessage()));
    }
    @ExceptionHandler(DuplicateKeyException.class)
    public ResponseEntity<Map<String,Object>> duplicate(DuplicateKeyException e) {
        return ResponseEntity.status(409).body(ApiSupport.error(409,"名称或绑定已存在，请重新加载后再试"));
    }
    @ExceptionHandler({HttpMessageNotReadableException.class,MissingServletRequestParameterException.class,MethodArgumentTypeMismatchException.class})
    public ResponseEntity<Map<String,Object>> invalid(Exception e) {
        return ResponseEntity.badRequest().body(ApiSupport.error(400,"请求参数格式不正确"));
    }
    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<Map<String,Object>> size(Exception e) {
        return ResponseEntity.status(413).body(ApiSupport.error(413,"素材大小不能超过 20MB"));
    }
    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String,Object>> internal(Exception e) {
        LOG.error("Expert API request failed",e);
        return ResponseEntity.status(500).body(ApiSupport.error(500,"服务处理失败，请稍后重试"));
    }
}
