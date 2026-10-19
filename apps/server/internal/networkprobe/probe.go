// Package networkprobe checks the same HTTP proxy environment used by API requests.
package networkprobe

import (
	"context"
	"crypto/x509"
	"errors"
	"net"
	"net/http"
	"net/url"
	"time"
)

type Result struct {
	Connected bool   `json:"connected"`
	Route     string `json:"route"`
	Status    int    `json:"status,omitempty"`
	ElapsedMS int64  `json:"elapsedMs"`
	Message   string `json:"message,omitempty"`
}

// Run makes one unauthenticated HEAD request, without following redirects or
// reading a response body. Any origin HTTP response proves network reachability,
// including 401/403/405; it does not prove login or model availability.
func Run(ctx context.Context) Result {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	defer transport.CloseIdleConnections()
	return probe(ctx, "https://chatgpt.com/robots.txt", transport)
}

func probe(ctx context.Context, target string, transport *http.Transport) (result Result) {
	started := time.Now()
	result.Route = "direct"
	defer func() { result.ElapsedMS = time.Since(started).Milliseconds() }()
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodHead, target, nil)
	if err != nil {
		result.Message = "检测地址无效。"
		return
	}
	req.Header.Set("User-Agent", "Reader-Network-Check")
	proxyAuthentication := errors.New("proxy authentication required")
	transport.OnProxyConnectResponse = func(_ context.Context, _ *url.URL, _ *http.Request, response *http.Response) error {
		if response.StatusCode == http.StatusProxyAuthRequired {
			return proxyAuthentication
		}
		return nil
	}
	if transport.Proxy != nil {
		proxy, proxyErr := transport.Proxy(req)
		if proxyErr != nil {
			result.Route = "unknown"
			result.Message = "代理配置无效，请检查地址和端口。"
			return
		}
		if proxy != nil {
			result.Route = "proxy"
		}
	}
	client := &http.Client{
		Transport:     transport,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	response, err := client.Do(req)
	if err != nil {
		var dns *net.DNSError
		var cert x509.UnknownAuthorityError
		var invalidCert x509.CertificateInvalidError
		var hostname x509.HostnameError
		switch {
		case errors.Is(ctx.Err(), context.DeadlineExceeded):
			result.Message = "连接超时，请检查代理和目标网站。"
		case errors.Is(err, proxyAuthentication):
			result.Message = "代理要求身份认证，请检查代理设置。"
		case errors.As(err, &cert) || errors.As(err, &invalidCert) || errors.As(err, &hostname):
			result.Message = "目标网站的 TLS 证书验证失败。"
		case errors.As(err, &dns):
			result.Message = "无法解析目标网站或代理的地址。"
		default:
			result.Message = "连接失败，请检查代理是否运行、地址和端口是否正确，以及目标网站是否可访问。"
		}
		return
	}
	defer response.Body.Close()
	result.Status = response.StatusCode
	if response.StatusCode == http.StatusProxyAuthRequired {
		result.Message = "代理要求身份认证，请检查代理设置。"
		return
	}
	result.Connected = true
	return
}
