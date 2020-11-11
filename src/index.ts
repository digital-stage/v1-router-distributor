import * as MongoClient from 'mongodb';
import * as pino from 'pino';
import { UWSProvider } from 'teckos';
import * as uWS from 'uWebSockets.js';
import { config } from 'dotenv';
import { getUserByToken } from './util';
import { Router } from './model/model.server';

config();

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
});

const { PORT, MONGO_DB, MONGO_COLLECTION } = process.env;

const uws = uWS.App();
const io = new UWSProvider(uws);

const startServer = async () => {
  const mongo = await MongoClient.connect(process.env.MONGO_URL, {});
  const db = mongo.db(MONGO_DB);

  // First delete all routers
  await db.collection(MONGO_COLLECTION).deleteMany({});

  uws.get('/beat', (res) => {
    res.end('Boom!');
  });

  // GET ALL AVAILABLE ROUTERS
  uws.options('/routers', (res) => {
    res
      .writeHeader('Access-Control-Allow-Origin', '*')
      .writeHeader('Access-Control-Allow-Methods', 'GET')
      .end();
  });
  uws.get('/routers', async (res) => {
    res.onAborted(() => {
      res.aborted = true;
    });
    const routers = await db.collection(MONGO_COLLECTION).find({}).toArray();
    if (!res.aborted) {
      res
        .writeHeader('Access-Control-Allow-Origin', '*')
        .end(JSON.stringify(routers));
    }
  });

  io.onConnection((socket) => {
    socket.on('token', (payload: {
      token: string;
      router: Omit<Router, '_id'>;
    }) => getUserByToken(payload.token)
      .then((user) => {
        logger.info('New router is asking for permission');
        let router: Router;
        const createRouter = async (initialRouter: Omit<Router, '_id'>) => {
          if (!initialRouter.url || !initialRouter.port) {
            throw new Error('Invalid request');
          }

          router = await db.collection(MONGO_COLLECTION).findOne({ url: initialRouter.url });
          if (router) {
            if (router.userId !== user._id) {
              throw new Error('Not allowed');
            }
            // Update router
            await db.collection(MONGO_COLLECTION).updateOne({ _id: router._id }, initialRouter);
            router = {
              ...router,
              ...initialRouter,
            };
            logger.info('Updated existing router');
          } else {
            router = await db.collection<Router>(MONGO_COLLECTION).insertOne({
              url: initialRouter.url,
              port: initialRouter.port,
              ipv4: initialRouter.ipv4,
              ipv6: initialRouter.ipv6,
              availableSlots: initialRouter.availableSlots,
              userId: user._id,
            })
              .then((result) => {
                if (result.result.ok) {
                  return {
                    // We have to set this only for typescript,
                    // since we already checked initial router for necessary keys
                    url: '',
                    port: 0,
                    ...initialRouter,
                    userId: user._id,
                    _id: result.insertedId,
                  };
                }
                throw new Error('Could not create router');
              });
            logger.info('Created new router');
          }
          io.toAll('router-added', router);
          socket.emit('router-ready', router);
        };

        socket.on('update-router', (update: Partial<Router>) => {
          if ((router && !update._id) || (update._id === router._id)) {
            db.collection(MONGO_COLLECTION).findOneAndUpdate({ _id: router._id }, {
              ...update,
              url: router.url,
              userId: user._id,
            }).then((result) => socket.emit('router-updated', result.value));
          }
        });

        socket.on('disconnect', () => {
          logger.info('Disconnected, remove router');
          if (router) {
            db.collection(MONGO_COLLECTION).deleteOne({ _id: router._id })
              .then(() => {
                io.toAll('router-removed', router);
              });
          }
        });

        if (!payload.router) {
          throw new Error('Invalid request');
        }
        logger.info('Creating new router');
        return createRouter(payload.router);
      })
      .catch((error) => {
        logger.error(error);
        socket.disconnect();
      }));
  });
};

const port = PORT ? parseInt(PORT, 10) : 5000;
startServer()
  .then(() => io.listen(port))
  .then(() => logger.info(`Listening on port ${port}`));
