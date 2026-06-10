'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { CompactorFactory } = require('../out/compaction/compactor.js');

// When the language server provides no symbols (not installed / still
// indexing), symbol-driven languages must fall back to line-based parsing
// instead of emitting an imports-only skeleton.
describe('symbol-less fallback', () => {
  const goSample = `package main

import "fmt"

type Server struct {
  port int
}

func NewServer(port int) *Server {
  return &Server{port: port}
}

func (s *Server) Start() error {
  fmt.Println(s.port)
  return nil
}
`;

  const javaSample = `package com.example;

import java.util.List;

public class UserService {
  private final UserRepo repo;

  public List<User> findAll() {
    return repo.findAll();
  }
}
`;

  const kotlinSample = `package com.example

import kotlinx.coroutines.flow.Flow

class OrderService(private val repo: OrderRepo) {
  fun findAll(): Flow<Order> {
    return repo.streamAll()
  }
}
`;

  test('Go: signatures survive with zero symbols', () => {
    const r = CompactorFactory.compact([], goSample, '/proj/server.go', 'go', '');
    assert.ok(r.skeleton.includes('type Server struct'));
    assert.ok(r.skeleton.includes('port int'));
    assert.ok(/func NewServer\(port int\) \*Server \{ \/\* \.\.\. \*\/ \}/.test(r.skeleton));
    assert.ok(/func \(s \*Server\) Start\(\) error/.test(r.skeleton));
    assert.ok(!r.skeleton.includes('fmt.Println'));
  });

  test('Java: class walked, methods collapsed with zero symbols', () => {
    const r = CompactorFactory.compact([], javaSample, '/proj/UserService.java', 'java', '');
    assert.ok(r.skeleton.includes('public class UserService'));
    assert.ok(/public List<User> findAll\(\) \{ \/\* \.\.\. \*\/ \}/.test(r.skeleton));
    assert.ok(!r.skeleton.includes('repo.findAll()'));
  });

  test('Kotlin: class walked, fun collapsed with zero symbols', () => {
    const r = CompactorFactory.compact([], kotlinSample, '/proj/OrderService.kt', 'kotlin', '');
    assert.ok(r.skeleton.includes('class OrderService'));
    assert.ok(/fun findAll\(\): Flow<Order> \{ \/\* \.\.\. \*\/ \}/.test(r.skeleton));
    assert.ok(!r.skeleton.includes('repo.streamAll()'));
  });

  test('Python: defs survive with zero symbols', () => {
    const py = 'import os\n\nclass Greeter:\n    def greet(self, name: str) -> str:\n        msg = f"hi {name}"\n        return msg\n';
    const r = CompactorFactory.compact([], py, '/proj/greet.py', 'python', '');
    assert.ok(r.skeleton.includes('class Greeter: ...'));
    assert.ok(r.skeleton.includes('def greet(self, name: str) -> str: ...'));
    assert.ok(!r.skeleton.includes('msg ='));
  });

  test('non-symbol languages are unaffected (php keeps its own compactor)', () => {
    const php = '<?php\nclass A {\n  public function b(): int {\n    return 1;\n  }\n}\n';
    const r = CompactorFactory.compact([], php, '/proj/a.php', 'php', '');
    assert.ok(r.skeleton.includes('class A'));
    assert.ok(/public function b\(\): int/.test(r.skeleton));
  });
});
