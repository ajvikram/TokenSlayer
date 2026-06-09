package com.example.app.controllers;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;
import java.util.Optional;

@RestController
@RequestMapping("/api/users")
public class UserController {

    private final UserService userService;
    private final AuditLogger auditLogger;

    @Autowired
    public UserController(UserService userService, AuditLogger auditLogger) {
        this.userService = userService;
        this.auditLogger = auditLogger;
    }

    @GetMapping
    public List<User> listUsers(@RequestParam(defaultValue = "0") int offset,
                                 @RequestParam(defaultValue = "20") int limit) {
        auditLogger.log("list", offset, limit);
        return userService.findAll(offset, limit);
    }

    @GetMapping("/{id}")
    public ResponseEntity<User> getUser(@PathVariable String id) {
        Optional<User> user = userService.findById(id);
        if (user.isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        auditLogger.log("get", id);
        return ResponseEntity.ok(user.get());
    }

    @PostMapping
    public ResponseEntity<User> createUser(@RequestBody CreateUserRequest req) {
        User created = userService.create(req.getName(), req.getEmail());
        auditLogger.log("create", created.getId());
        return ResponseEntity.status(201).body(created);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> deleteUser(@PathVariable String id) {
        boolean deleted = userService.delete(id);
        if (!deleted) {
            return ResponseEntity.notFound().build();
        }
        auditLogger.log("delete", id);
        return ResponseEntity.noContent().build();
    }
}
