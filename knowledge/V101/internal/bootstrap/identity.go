package bootstrap

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"nebulaekno/internal/config"
	"os"
	"path/filepath"
	"syscall"
)

type Identity struct {
	ID  string `json:"installation_id"`
	Key []byte `json:"key"`
}

func LoadIdentity(root string) (id Identity, err error) {
	for _, d := range []string{"config", "files", "previews", "derived", "media", "tmp", "logs", "backups"} {
		if e := os.MkdirAll(filepath.Join(root, d), 0700); e != nil {
			return id, config.Fail("DATA_DIR_UNWRITABLE", "storage", "无法创建数据目录")
		}
		probe, e := os.CreateTemp(filepath.Join(root, d), ".write-probe-")
		if e != nil {
			return id, config.Fail("DATA_DIR_UNWRITABLE", "storage", "数据子目录不可写: "+d)
		}
		_, e = probe.Write([]byte("probe"))
		if e == nil {
			e = probe.Sync()
		}
		probe.Close()
		os.Remove(probe.Name())
		if e != nil {
			return id, config.Fail("DATA_DIR_UNWRITABLE", "storage", "数据子目录写入失败: "+d)
		}
	}
	f, e := os.OpenFile(filepath.Join(root, "config", ".lock"), os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return id, config.Fail("DATA_DIR_UNWRITABLE", "storage", "无法打开卷身份锁")
	}
	defer f.Close()
	if e = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); e != nil {
		return id, config.Fail("INITIALIZATION_LOCKED", "storage", "另一个进程正在初始化文件卷")
	}
	defer syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
	p := filepath.Join(root, "config", "installation.json")
	b, e := os.ReadFile(p)
	if e == nil {
		if json.Unmarshal(b, &id) != nil || len(id.Key) != 32 || uuid.Validate(id.ID) != nil {
			return id, config.Fail("VOLUME_IDENTITY_INVALID", "storage", "文件卷身份或加密密钥无效")
		}
		return id, nil
	}
	if !os.IsNotExist(e) {
		return id, config.Fail("DATA_DIR_UNREADABLE", "storage", "无法读取卷身份")
	}
	for _, d := range []string{"files", "previews", "derived", "media"} {
		entries, e := os.ReadDir(filepath.Join(root, d))
		if e != nil || len(entries) > 0 {
			return id, config.Fail("VOLUME_IDENTITY_MISSING", "storage", "已有文件但卷身份丢失，需恢复配套身份文件")
		}
	}
	id.ID = uuid.NewString()
	id.Key = make([]byte, 32)
	if _, e = rand.Read(id.Key); e != nil {
		return id, e
	}
	b, _ = json.Marshal(id)
	tmp := p + ".tmp"
	if e = os.WriteFile(tmp, b, 0600); e != nil {
		return id, config.Fail("DATA_DIR_UNWRITABLE", "storage", "无法保存加密密钥")
	}
	file, e := os.OpenFile(tmp, os.O_RDWR, 0600)
	if e != nil {
		return id, e
	}
	e = file.Sync()
	file.Close()
	if e != nil {
		return id, e
	}
	if e = os.Rename(tmp, p); e != nil {
		return id, e
	}
	directory, e := os.Open(filepath.Dir(p))
	if e != nil {
		return id, e
	}
	e = directory.Sync()
	directory.Close()
	if e != nil {
		return id, e
	}
	return id, nil
}
func (id Identity) Fingerprint() string { s := sha256.Sum256(id.Key); return hex.EncodeToString(s[:]) }
func (id Identity) Encrypt(s string) ([]byte, error) {
	block, e := aes.NewCipher(id.Key)
	if e != nil {
		return nil, e
	}
	g, e := cipher.NewGCM(block)
	if e != nil {
		return nil, e
	}
	nonce := make([]byte, g.NonceSize())
	if _, e = rand.Read(nonce); e != nil {
		return nil, e
	}
	return g.Seal(nonce, nonce, []byte(s), []byte(id.ID)), nil
}
func (id Identity) Decrypt(b []byte) (string, error) {
	if len(b) == 0 {
		return "", nil
	}
	block, e := aes.NewCipher(id.Key)
	if e != nil {
		return "", e
	}
	g, e := cipher.NewGCM(block)
	if e != nil {
		return "", e
	}
	if len(b) < g.NonceSize() {
		return "", fmt.Errorf("invalid encrypted credential")
	}
	plain, e := g.Open(nil, b[:g.NonceSize()], b[g.NonceSize():], []byte(id.ID))
	return string(plain), e
}
