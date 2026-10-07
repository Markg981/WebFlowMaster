export function drillCompose(root, key, session, imageTag = 'local') {
  const environment = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://wfm_drill:drill@postgres:5432/webflowmaster',
    REDIS_URL: 'redis://redis:6379',
    ENCRYPTION_KEY: key,
    SESSION_SECRET: session,
    SESSION_COOKIE_SECURE: 'false',
    REGISTRATION: 'open',
    ARTIFACT_STORE: 'local',
    APP_BASE_URL: 'http://api:5000',
    AUTH_RATE_LIMIT: '100',
  };
  const volumes = ['results:/app/results', 'visual_baselines:/app/data/visual-baselines'];
  return {
    services: {
      postgres: {
        image: 'postgres:16-alpine',
        environment: { POSTGRES_PASSWORD: 'drill', POSTGRES_DB: 'webflowmaster' },
        volumes: ['pg_data:/var/lib/postgresql/data'],
        healthcheck: {
          test: ['CMD-SHELL', 'pg_isready -U postgres'],
          interval: '2s',
          timeout: '3s',
          retries: 30,
        },
      },
      redis: {
        image: 'redis:7-alpine',
        healthcheck: {
          test: ['CMD', 'redis-cli', 'ping'],
          interval: '2s',
          timeout: '3s',
          retries: 30,
        },
      },
      migrate: {
        image: `wfm-restore-drill-api:${imageTag}`,
        environment: {
          ...environment,
          DATABASE_URL: 'postgres://postgres:drill@postgres:5432/webflowmaster',
        },
        command: ['node', 'dist/apply-migrations.js'],
      },
      api: {
        image: `wfm-restore-drill-api:${imageTag}`,
        build: { context: root, dockerfile: 'Dockerfile' },
        environment,
        volumes,
        ports: ['127.0.0.1::5000'],
      },
      worker: {
        image: `wfm-restore-drill-worker:${imageTag}`,
        build: { context: root, dockerfile: 'Dockerfile.worker' },
        environment,
        volumes,
        shm_size: '1gb',
      },
    },
    volumes: { pg_data: {}, results: {}, visual_baselines: {} },
  };
}

export function recoveryMetrics(createdAt, start, end, phases, now = new Date()) {
  return {
    recoveryDurationMs: Math.round(end - start),
    // Backup age is an observation, not a guaranteed RPO: no production write stream here.
    backupAgeAtRecoveryMs: Math.max(0, now.getTime() - Date.parse(createdAt)),
    phases,
    success: phases.length > 0 && phases.every((phase) => phase.success),
  };
}
