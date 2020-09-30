module.exports = {
    apps: [{
        name: "router-distributor",
        script: "dist/index.js",

        // Options reference: https://pm2.keymetrics.io/docs/usage/application-declaration/
        instances: 1,
        autorestart: true,
        watch: false,
        max_memory_restart: '300M',
        env: {
            "NODE_ENV": 'development'
        },
        env_production: {
            "NODE_ENV": "production"
        },
    }],

    deploy: {
        production: {
            user: 'node',
            host: 'routers.digital-stage.org',
            ref: 'origin/master',
            repo: "https://github.com/digital-stage/router-distributor.git",
            path: '/node/router-distributor',
            env: {
                "EMAIL": "test@digital-stage.org",
                "PASSWORD": "testtesttest",
                "AUTH_URL": "https://auth.digital-stage.org",
                "MONGO_URL": "mongodb://10.114.0.4:27017",
                "PORT": 3000,
                "NODE_ENV": "production"
            },
            'post-deploy': 'npm install && npm run build && pm2 restart ecosystem.config.js --env production'
        }
    }
};
