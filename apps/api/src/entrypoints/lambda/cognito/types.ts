export type CognitoAttribute = {
  Name?: string;
  Value?: string;
};

export type CognitoTriggerEvent = {
  triggerSource?: string;
  userPoolId: string;
  userName: string;
  request: {
    userAttributes?: Record<string, string>;
    userContextData?: {
      ipAddress?: string;
      encodedData?: string;
    };
    validationData?: Record<string, string>;
    clientMetadata?: Record<string, string>;
  };
  response: Record<string, unknown>;
};

export type CognitoUserSnapshot = {
  Username?: string;
  UserStatus?: string;
  UserAttributes?: CognitoAttribute[];
};
