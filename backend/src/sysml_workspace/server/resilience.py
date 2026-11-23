"""Bounded process-local breakers; no implicit retries of billable or mutating calls."""

from __future__ import annotations

import asyncio
import json
import time

import httpx


class CircuitOpen(RuntimeError):
    pass


class ComponentFailure(RuntimeError):
    pass


class CircuitBreaker:
    def __init__(self, threshold=3, cooldown=30.0, clock=time.monotonic):
        self.threshold, self.cooldown, self.clock = threshold, cooldown, clock
        self.failures = 0
        self.open_until = 0.0
        self.probe = False
        self.generation = 0

    def acquire(self):
        if self.open_until:
            if self.clock() < self.open_until or self.probe:
                raise CircuitOpen("dependency_temporarily_unavailable")
            self.probe = True
        return self.generation

    def success(self, ticket):
        if ticket != self.generation:
            return
        self.failures = 0
        if self.open_until:
            self.open_until, self.probe = 0.0, False
            self.generation += 1

    def failure(self, ticket):
        if ticket != self.generation:
            return
        self.failures += 1
        if self.failures >= self.threshold or self.probe:
            self.open_until = self.clock() + self.cooldown
            self.probe = False
            self.generation += 1

    def abandon(self, ticket):
        if ticket == self.generation and self.probe:
            self.probe = False
            self.open_until = self.clock() + self.cooldown
            self.generation += 1


class ComponentClient:
    def __init__(self, transport=None):
        self.http = httpx.AsyncClient(
            timeout=httpx.Timeout(10, connect=3),
            follow_redirects=False,
            transport=transport,
            limits=httpx.Limits(max_connections=12, max_keepalive_connections=6),
        )
        self.breakers = {name: CircuitBreaker() for name in ("renderer", "rag")}

    async def request(
        self,
        name,
        url,
        token,
        *,
        payload=None,
        max_bytes=256 * 1024,
        timeout=15,
        method="POST",
        accepted=(200,),
    ):
        breaker = self.breakers[name]
        ticket = breaker.acquire()
        try:
            async with (
                asyncio.timeout(timeout),
                self.http.stream(
                    method,
                    url,
                    headers={"Authorization": "Bearer " + token},
                    json=payload,
                ) as response,
            ):
                if response.status_code not in accepted:
                    raise ComponentFailure(f"{name}_unavailable")
                data = bytearray()
                async for chunk in response.aiter_bytes():
                    data.extend(chunk)
                    if len(data) > max_bytes:
                        raise ComponentFailure(f"{name}_invalid_response")
                value = json.loads(data)
                if not isinstance(value, dict):
                    raise ComponentFailure(f"{name}_invalid_response")
                breaker.success(ticket)
                return response.status_code, value
        except asyncio.CancelledError:
            breaker.abandon(ticket)
            raise
        except (httpx.HTTPError, ValueError, RuntimeError, TimeoutError):
            breaker.failure(ticket)
            raise

    async def ready(self, name, url, token):
        if not url or not token:
            return False
        try:
            _, result = await self.request(
                name,
                url.rstrip("/") + "/health/ready",
                token,
                method="GET",
                timeout=3,
                max_bytes=4096,
            )
            return result.get("status") == "ready"
        except (httpx.HTTPError, ValueError, RuntimeError, TimeoutError):
            return False

    async def close(self):
        await self.http.aclose()
