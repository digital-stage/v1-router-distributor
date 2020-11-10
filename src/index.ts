import * as MongoClient from 'mongodb';
import * as pino from 'pino';
import { UWSProvider } from 'teckos';
import * as uWS from 'uWebSockets.js';
import { getUserByToken } from './util';
import { Router } from './model/model.server';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
});

const { PORT } = process.env;

const DATABASE: string = 'digitalstage';
const COLLECTION: string = 'routers';

const uws = uWS.App();
const io = new UWSProvider(uws);

const startServer = async () => {
  const mongo = await MongoClient.connect(process.env.MONGO_URL, {
  });
  const db = mongo.db(DATABASE);

  // First delete all routers
  await db.collection(COLLECTION).deleteMany({});

  uws.get('/beat', (res) => {
    res.end('Boom!');
  });

  // GET ALL AVAILABLE ROUTERS
  uws.get('/routers', async (res) => {
    res.onAborted(() => {
      res.aborted = true;
    });
    const routers = await db.collection(COLLECTION).find({}).toArray();
    if (!res.aborted) {
      res.end(JSON.stringify(routers));
    }
  });

  io.onConnection((socket) => {
    socket.on('token', (payload: {
      token: string;
      router: Omit<Router, '_id'>;
    }) => getUserByToken(payload.token)
      .then((user) => {
        let router: Router;
        const createRouter = async (initialRouter: Omit<Router, '_id'>) => {
          if (!initialRouter.url || !initialRouter.port) {
            throw new Error('Invalid request');
          }

          router = await db.collection(COLLECTION).findOne({ url: initialRouter.url });
          if (router) {
            if (router.userId !== user._id) {
              throw new Error('Not allowed');
            }
            // Update router
            await db.collection(COLLECTION).updateOne({ _id: router._id }, initialRouter);
            router = {
              ...router,
              ...initialRouter,
            };
            logger.info('Updated existing router');
          } else {
            router = await db.collection<Router>(COLLECTION).insertOne({
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
          socket.emit('ready', router);
        };

        socket.on('update-router', (update: Partial<Router>) => {
          if ((router && !update._id) || (update._id === router._id)) {
            db.collection(COLLECTION).findOneAndUpdate({ _id: router._id }, {
              ...update,
              url: router.url,
              userId: user._id,
            }).then((result) => socket.emit('router-updated', result.value));
          }
        });

        socket.on('disconnect', () => {
          logger.info('Disconnected, remove router');
          if (router) {
            db.collection(COLLECTION).deleteOne({ _id: router._id })
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
        console.error(error);
        socket.disconnect();
      }));
  });
};

const port = PORT ? parseInt(PORT, 10) : 5000;
startServer()
  .then(() => io.listen(port))
  .then(() => logger.info(`Listening on port ${port}`));
