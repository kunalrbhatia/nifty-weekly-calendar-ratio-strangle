import { getSmartApi, retryCall } from './api.js';
import { isPaperMode } from './modeManager.js';
import { sendAlert } from '../notifier.js';

export interface OrderParams {
  symbol: string;
  token: string;
  side: 'BUY' | 'SELL';
  qty: number;
}

export async function placeMarketOrder(params: OrderParams): Promise<string> {
  const { symbol, token, side, qty } = params;

  if (isPaperMode()) {
    const mockOrderId = `MOCK-ORDER-${side}-${token}-${Date.now()}`;
    console.log(
      `[PAPER] Placed market order: ${side} ${qty} lots of ${symbol} (${token}). ID: ${mockOrderId}`
    );
    return mockOrderId;
  }

  const api = await getSmartApi();

  // Rule 2.4: Order placement must NEVER be blindly auto-retried.
  // Instead, we call it once. If we get an error or a timeout, we check the order book first
  // before we decide if it failed or if we should alert.
  try {
    const res = await api.placeOrder({
      variety: 'NORMAL',
      tradingsymbol: symbol,
      symboltoken: token,
      transactiontype: side,
      exchange: 'NFO',
      ordertype: 'MARKET',
      producttype: 'CARRYFORWARD',
      duration: 'DAY',
      price: '0',
      squareoff: '0',
      stoploss: '0',
      trailingstoploss: '0',
      quantity: String(qty),
    });

    if (res.status && res.data && res.data.orderid) {
      return res.data.orderid;
    }
    throw new Error(res.message || 'Place order returned empty response');
  } catch (err: any) {
    console.error(`Order placement API error for ${symbol}:`, err);
    // Safety check: fetch order book to see if the order was actually placed successfully
    // despite the network error/timeout.
    try {
      console.log(`Checking order book to reconcile failed order placement for ${symbol}...`);
      const orderBook = await retryCall(async () => {
        const ob = await api.getOrderBook();
        if (ob.status && Array.isArray(ob.data)) {
          return ob.data;
        }
        throw new Error(ob.message || 'Order book fetch empty');
      }, 'Reconcile Order Book');

      // Find if there is a matching order placed in the last few seconds
      const matchingOrder = orderBook.find(
        (o: any) =>
          o.tradingsymbol === symbol &&
          o.symboltoken === token &&
          o.transactiontype === side &&
          o.quantity === String(qty) &&
          ['open', 'complete', 'validation pending'].includes(o.status?.toLowerCase())
      );

      if (matchingOrder && matchingOrder.orderid) {
        console.log(
          `✓ Reconciled order: found existing order in book with ID ${matchingOrder.orderid}`
        );
        return matchingOrder.orderid;
      }
    } catch (reconcileErr) {
      console.error('Failed to reconcile order book:', reconcileErr);
    }

    throw err;
  }
}

export async function confirmOrderFill(
  orderId: string,
  symbol: string,
  token: string
): Promise<number> {
  if (isPaperMode()) {
    // Return mock price based on symbol/token or just default values
    // Long T1 legs premium: let's mock 150.
    // Short T0 legs premium: let's mock 75.
    if (orderId.includes('BUY')) {
      return 150;
    }
    return 75;
  }

  const api = await getSmartApi();

  const task = async () => {
    const ob = await api.getOrderBook();
    if (!ob.status || !Array.isArray(ob.data)) {
      throw new Error(ob.message || 'Order book returned empty data');
    }

    const order = ob.data.find((o: any) => o.orderid === orderId);
    if (!order) {
      throw new Error(`Order ID ${orderId} not found in order book`);
    }

    const status = order.status?.toLowerCase();
    if (status === 'complete' || status === 'completed') {
      const avgPrice = parseFloat(order.averageprice || order.price || '0');
      if (avgPrice <= 0) {
        throw new Error(`Order completed but averageprice is invalid: ${order.averageprice}`);
      }
      return avgPrice;
    } else if (status === 'rejected' || status === 'cancelled' || status === 'canceled') {
      throw new Error(`Order was ${status}: ${order.text || 'No reject reason'}`);
    } else {
      // Order is open/pending. Wait for next retry
      throw new Error(`Order status is pending: ${status}`);
    }
  };

  // Try 3 times to confirm status
  return retryCall(task, `Confirm Order Fill ${orderId}`, 3, 1500);
}
