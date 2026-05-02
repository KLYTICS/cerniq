import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis, { type Redis as RedisClient } from 'ioredis';
import { AppConfigService } from '../../config/config.service';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client!: RedisClient;

  constructor(private readonly config: AppConfigService) {}

  async onModuleInit(): Promise<void> {
    this.client = new Redis(this.config.redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
    });
    this.client.on('error', (err) => this.logger.error(`Redis error: ${err.message}`));
    this.client.on('ready', () => this.logger.log('Redis ready'));
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit();
  }

  raw(): RedisClient {
    return this.client;
  }

  async ping(): Promise<boolean> {
    try {
      const reply = await this.client.ping();
      return reply === 'PONG';
    } catch {
      return false;
    }
  }

  /**
   * Get a JSON value or `null`. Failures fall back to `null` rather than
   * throwing — callers in the hot path treat cache as best-effort.
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.client.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch (err) {
      this.logger.warn(`redis.get(${key}) failed: ${(err as Error).message}`);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    try {
      const payload = JSON.stringify(value);
      if (ttlSeconds && ttlSeconds > 0) {
        await this.client.set(key, payload, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, payload);
      }
    } catch (err) {
      this.logger.warn(`redis.set(${key}) failed: ${(err as Error).message}`);
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      await this.client.del(...keys);
    } catch (err) {
      this.logger.warn(`redis.del failed: ${(err as Error).message}`);
    }
  }

  /**
   * Atomic increment with TTL applied on first set (NX). Returns the new value.
   * Uses a Lua script so increment + EXPIRE is atomic.
   */
  async incrBy(key: string, by: number, ttlSeconds: number): Promise<number> {
    const script = `
      local v = redis.call('INCRBYFLOAT', KEYS[1], ARGV[1])
      redis.call('EXPIRE', KEYS[1], ARGV[2])
      return v
    `;
    try {
      const reply = (await this.client.eval(script, 1, key, by.toString(), ttlSeconds.toString())) as string;
      return parseFloat(reply);
    } catch (err) {
      this.logger.warn(`redis.incrBy(${key}) failed: ${(err as Error).message}`);
      return 0;
    }
  }
}
