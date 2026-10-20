import { Router, type IRouter } from "express";
import healthRouter from "./health";
import partnersRouter from "./partners";
import briefingsRouter from "./briefings";
import yellowlimersRouter from "./yellowlimers";
import articlesRouter from "./articles";
import storageRouter from "./storage";
import semrushRouter from "./semrush";
import partnerProfilesRouter from "./partnerProfiles";
import articleGenerationsRouter from "./articleGenerations";
import websiteArticlesRouter from "./websiteArticles";
import googleRouter from "./google";
import topicIdeasRouter from "./topicIdeas";

const router: IRouter = Router();

router.use(healthRouter);
router.use(partnersRouter);
router.use(briefingsRouter);
router.use(yellowlimersRouter);
router.use(articlesRouter);
router.use(storageRouter);
router.use(semrushRouter);
router.use(partnerProfilesRouter);
router.use(articleGenerationsRouter);
router.use(websiteArticlesRouter);
router.use(googleRouter);
router.use(topicIdeasRouter);

export default router;
