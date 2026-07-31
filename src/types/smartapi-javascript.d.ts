declare module 'smartapi-javascript' {
  export class SmartAPI {
    constructor(config: { api_key: string });
    generateSession(clientCode: string, pin: string, totp: string): Promise<any>;
    getProfile(): Promise<any>;
    getLtpData(params: { exchange: string; tradingsymbol: string; symboltoken: string }): Promise<any>;
    getRMSLimit(): Promise<any>;
    placeOrder(params: any): Promise<any>;
    getOrderBook(): Promise<any>;
    getMarketData(params: any): Promise<any>;
  }

  export class WebSocketV2 {
    constructor(config: { jwttoken: string; apikey: string; clientcode: string; feedtype: string });
    connect(): Promise<any>;
    fetchData(params: any): any;
    on(event: string, callback: (data: any) => void): void;
    close(): void;
  }
}
