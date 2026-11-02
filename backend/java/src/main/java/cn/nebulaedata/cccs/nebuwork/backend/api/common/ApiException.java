package cn.nebulaedata.cccs.nebuwork.backend.api.common;

public class ApiException extends RuntimeException {
    public final int status;
    public ApiException(int status, String message) { super(message); this.status = status; }
}
