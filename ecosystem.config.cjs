const path = require('path');

module.exports = {
  apps: [
    {
      name: 'llm-council',
      cwd: __dirname,
      script: path.join(__dirname, 'backend', 'server.js'),
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
        PORT: '8001',
        HOST: '0.0.0.0',
      },
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      time: true,
    },
  ],
};
