import * as MongoClient from "mongodb";
import * as socketIO from "socket.io";
import {authorizeSocket} from "./util";
import * as pino from "pino";
import * as express from "express";
import * as cors from "cors";
import {Router} from "./model/model.server";

const logger = pino({
    level: process.env.LOG_LEVEL || 'info'
});


const DATABASE: string = "digitalstage";
const COLLECTION: string = "routers";

const app = express();
app.use(express.urlencoded({extended: true}));
app.use(cors({origin: true}));
app.options('*', cors());

const server = app.listen(process.env.PORT);

const io = new socketIO(server);

const startServer = async () => {
    const mongo = await MongoClient.connect(process.env.MONGO_URL, {
        useUnifiedTopology: true
    });
    const db = mongo.db(DATABASE);

    // First delete all routers
    await db.collection(COLLECTION).deleteMany({});

    app.get('/beat', function (req, res) {
        res.send('Boom!');
    });

    // GET ALL AVAILABLE ROUTERS
    app.get('/routers', function (req, res) {
        return db.collection(COLLECTION).find({}).toArray()
            .then(routers => {
                res.status(200).json(routers)
            });
    });

    io.on('connection', socket => {
        return authorizeSocket(socket)
            .then(user => {
                let router: Router = undefined;
                const createRouter = async (initialRouter: Omit<Router, "_id">) => {
                    if (!initialRouter.url || !initialRouter.port) {
                        throw new Error("Invalid request");
                    }

                    router = await db.collection(COLLECTION).findOne({url: initialRouter.url})
                    if (router) {
                        if (router.userId !== user._id) {
                            throw new Error("Not allowed");
                        }
                        // Update router
                        await db.collection(COLLECTION).updateOne({_id: router._id}, initialRouter);
                        router = {
                            ...router,
                            ...initialRouter
                        };
                        logger.info("Updated existing router");
                    } else {
                        router = await db.collection<Router>(COLLECTION).insertOne({
                            url: initialRouter.url,
                            ipv4: initialRouter.ipv4,
                            ipv6: initialRouter.ipv6,
                            port: initialRouter.port,
                            availableSlots: initialRouter.availableSlots,
                            userId: user._id
                        })
                            .then(result => {
                                if (result.result.ok) {
                                    return {
                                        // We have to set this only for typescript, since we already checked initial router for necessary keys
                                        url: "",
                                        port: 0,
                                        ...initialRouter,
                                        userId: user._id,
                                        _id: result.insertedId
                                    };
                                }
                            });
                        logger.info("Created new router");
                    }
                    socket.emit("ready", router);
                    socket.broadcast.emit("router-added", router);
                };

                socket.on("update-router", (update: Partial<Router>) => {
                    if (router && !update._id || update._id === router._id) {
                        return db.collection(COLLECTION).findOneAndUpdate({_id: router._id}, {
                            ...update,
                            url: router.url,
                            userId: user._id
                        }).then(result => socket.emit("router-updated", result.value));
                    }
                })

                socket.on("disconnect", () => {
                    logger.info("Disconnected, remove router");
                    if (router) {
                        return db.collection(COLLECTION).deleteOne({_id: router._id})
                            .then(() => {
                                socket.broadcast.emit("router-removed", router);
                            })
                    }
                });

                logger.info("New router available");
                if (!socket.handshake.query || !socket.handshake.query.router) {
                    throw new Error("Invalid request");
                }
                return createRouter(JSON.parse(socket.handshake.query.router));
            })
            .catch(error => {
                socket.disconnect(true);
                logger.warn(error);
            });
    });
}
startServer()
    .then(() => logger.info("Listening on port " + process.env.PORT))