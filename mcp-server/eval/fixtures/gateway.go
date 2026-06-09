package gateway

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"time"
)

var ErrNotFound = errors.New("route not found")
var ErrRateLimited = errors.New("rate limit exceeded")

type RouteConfig struct {
	Path        string
	Handler     http.HandlerFunc
	RateLimit   int
	TimeoutMs   int
}

type Gateway struct {
	mu       sync.RWMutex
	routes   map[string]RouteConfig
	counters map[string]int
	port     int
}

func NewGateway(port int) *Gateway {
	return &Gateway{
		routes:   make(map[string]RouteConfig),
		counters: make(map[string]int),
		port:     port,
	}
}

func (g *Gateway) Register(cfg RouteConfig) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	if _, exists := g.routes[cfg.Path]; exists {
		return errors.New("route already registered")
	}
	g.routes[cfg.Path] = cfg
	return nil
}

func (g *Gateway) RouteTraffic(ctx context.Context, path string, w http.ResponseWriter, r *http.Request) error {
	g.mu.RLock()
	cfg, ok := g.routes[path]
	g.mu.RUnlock()
	if !ok {
		return ErrNotFound
	}

	if !g.allowRequest(path, cfg.RateLimit) {
		return ErrRateLimited
	}

	timeout := time.Duration(cfg.TimeoutMs) * time.Millisecond
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	cfg.Handler(w, r)
	return nil
}

func (g *Gateway) allowRequest(path string, limit int) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.counters[path]++
	return limit == 0 || g.counters[path] <= limit
}
