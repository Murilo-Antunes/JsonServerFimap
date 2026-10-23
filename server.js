require('dotenv').config();
const express = require('express');
const jsonServer = require('json-server');
const { createConfig } = require('./lib/config');
const { createApp } = require('./lib/app');

const config = createConfig();
const router = jsonServer.router(config.dbFile); // router.db é a instância lowdb

const app = createApp({ express, db: router.db, jsonServerRouter: router, config });

app.listen(config.port, () => {
  console.log(`FIMAP API em http://localhost:${config.port} (${config.isProd ? 'produção' : 'desenvolvimento'})`);
  if (config.corsOrigins.length === 0) {
    console.log('CORS_ORIGINS vazio: aceitando qualquer origem. Defina-o em produção.');
  }
});
