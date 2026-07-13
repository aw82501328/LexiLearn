module.exports = {
  apps: [{
    name: 'lexilearn',
    script: 'server.js',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      DATA_DIR: '/root/eldata',
      JWT_SECRET: 'lexilearn-prod-secret-fixed-2026',
    },
  }],
};
