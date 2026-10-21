import "reflect-metadata";
import { createRecoverEmailPublishes } from "../../../modules/email-deliveries/email-background.composition.js";
export const handler = async (_event:unknown,context?:{awsRequestId?:string}) => createRecoverEmailPublishes().execute(context?.awsRequestId);
