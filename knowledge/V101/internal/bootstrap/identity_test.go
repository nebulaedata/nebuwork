package bootstrap

import (
	"os"
	"path/filepath"
	"testing"
)

func TestIdentityRoundTrip(t *testing.T) {
	dir := t.TempDir()
	a, e := LoadIdentity(dir)
	if e != nil {
		t.Fatal(e)
	}
	b, e := LoadIdentity(dir)
	if e != nil || a.ID != b.ID || a.Fingerprint() != b.Fingerprint() {
		t.Fatal("identity changed", e)
	}
	sealed, e := a.Encrypt("供应商凭证")
	if e != nil {
		t.Fatal(e)
	}
	plain, e := b.Decrypt(sealed)
	if e != nil || plain != "供应商凭证" {
		t.Fatal("decrypt failed", e)
	}
	sealed[len(sealed)-1] ^= 1
	if _, e = b.Decrypt(sealed); e == nil {
		t.Fatal("tampering accepted")
	}
}
func TestIdentityLoss(t *testing.T) {
	dir := t.TempDir()
	_, e := LoadIdentity(dir)
	if e != nil {
		t.Fatal(e)
	}
	os.WriteFile(filepath.Join(dir, "files", "document.txt"), []byte("source"), 0600)
	os.Remove(filepath.Join(dir, "config", "installation.json"))
	if _, e = LoadIdentity(dir); e == nil {
		t.Fatal("lost identity silently recreated")
	}
}
