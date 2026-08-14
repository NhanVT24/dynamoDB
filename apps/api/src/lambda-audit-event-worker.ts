import "reflect-metadata";

export const handler = async (event: unknown) => {
  console.log("[lambda-eventbridge:audit-event-worker] received", event);

  return {
    ok: true
  };
};
