import "reflect-metadata";
import { createWatchEmailRouting } from "../../../modules/email-deliveries/email-background.composition.js";
export const handler = async (_event:unknown,context?:{awsRequestId?:string}) => createWatchEmailRouting().execute(context?.awsRequestId);
