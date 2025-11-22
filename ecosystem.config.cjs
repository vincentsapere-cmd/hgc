/**
 * PM2 Ecosystem Configuration
 * For production deployment on Hostinger
 */

module.exports = {
  apps: [{
    name: 'hgc-backend',
    cwd: './server',
    script: 'src/index.js',
    instances: 1,
    exec_mode: 'fork',
    node_args: '--experimental-specifier-resolution=node',
    env: {
      NODE_ENV: 'production'
    },
    env_development: {
      NODE_ENV: 'development'
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    max_memory_restart: '500M',
    watch: false,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 1000,
    kill_timeout: 3000
  }]
};
