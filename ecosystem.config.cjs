module.exports = {
  apps: [
    {
      name: 'nifty-weekly-calendar-ratio-strangle',
      script: './dist/main.js',
      env: {
        NODE_ENV: 'production',
        TZ: 'UTC',
      },
    },
  ],
};
