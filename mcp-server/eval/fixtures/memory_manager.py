"""Persistent memory manager for an LLM agent.

Stores conversation history and structured facts to disk, with TTL eviction.
"""
import json
import os
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional


@dataclass
class MemoryEntry:
    """A single piece of memory bound to an agent."""
    agent_id: str
    key: str
    value: Any
    created_at: datetime
    ttl_seconds: Optional[int] = None


class MemoryManager:
    """Manages agent memory with disk persistence and TTL eviction."""

    DEFAULT_TTL = 86400  # 1 day

    def __init__(self, agent_id: str, storage_path: str = "/tmp/memory"):
        self.agent_id = agent_id
        self.storage_path = storage_path
        self.cache: Dict[str, MemoryEntry] = {}
        os.makedirs(storage_path, exist_ok=True)
        self._load_from_disk()

    async def store(self, key: str, value: Any, ttl: Optional[int] = None) -> None:
        """Store a value under the given key with an optional TTL override."""
        entry = MemoryEntry(
            agent_id=self.agent_id,
            key=key,
            value=value,
            created_at=datetime.utcnow(),
            ttl_seconds=ttl or self.DEFAULT_TTL,
        )
        self.cache[key] = entry
        await self._persist(entry)

    async def retrieve(self, key: str) -> Optional[Any]:
        """Get a value by key, returning None if missing or expired."""
        entry = self.cache.get(key)
        if entry is None:
            return None
        if self._is_expired(entry):
            del self.cache[key]
            return None
        return entry.value

    def list_keys(self) -> List[str]:
        return [k for k, v in self.cache.items() if not self._is_expired(v)]

    def _is_expired(self, entry: MemoryEntry) -> bool:
        if entry.ttl_seconds is None:
            return False
        age = (datetime.utcnow() - entry.created_at).total_seconds()
        return age > entry.ttl_seconds

    def _load_from_disk(self) -> None:
        try:
            with open(os.path.join(self.storage_path, f"{self.agent_id}.json")) as f:
                raw = json.load(f)
                for k, v in raw.items():
                    self.cache[k] = MemoryEntry(**v)
        except FileNotFoundError:
            pass

    async def _persist(self, entry: MemoryEntry) -> None:
        path = os.path.join(self.storage_path, f"{self.agent_id}.json")
        with open(path, "w") as f:
            json.dump({k: v.__dict__ for k, v in self.cache.items()}, f, default=str)
