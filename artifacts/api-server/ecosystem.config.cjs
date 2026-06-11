module.exports = {
  apps: [{
    name: 'jobpro-api',
    script: './dist/index.mjs',
    env: {
      NODE_ENV: 'production',
      PORT: '3001',
      TZ: 'America/Sao_Paulo',
      DATABASE_URL: 'postgresql://jobpro:jobpro2024@localhost:5432/jobpro',
      SESSION_SECRET: 'jobpro_secret_2024_nagib_x9f3k2p1'
    }
  }]
}
