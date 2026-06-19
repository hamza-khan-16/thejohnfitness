/**
 * Razorpay Integration — The John Fitness
 */

declare global { interface Window { Razorpay: any; } }

export interface RazorpayOptions {
  key: string; amount: number; currency: string; name: string;
  description: string; order_id?: string;
  prefill?: { name?: string; email?: string; contact?: string; };
  notes?: Record<string, string>;
  theme?: { color: string };
  handler: (response: RazorpayResponse) => void;
  modal?: { ondismiss?: () => void; };
}
export interface RazorpayResponse {
  razorpay_payment_id: string;
  razorpay_order_id?: string;
  razorpay_signature?: string;
}

export function loadRazorpay(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

// FIX #5: Returns a Promise that resolves on success/failure so the caller can await it
export function openRazorpayCheckout(opts: {
  amount: number;
  planName: string;
  userName?: string;
  userEmail?: string;
  userPhone?: string;
}): Promise<string> {
  return new Promise(async (resolve, reject) => {
    const loaded = await loadRazorpay().catch(() => false);
    if (!loaded) { reject(new Error("Razorpay SDK failed to load. Check your internet connection.")); return; }

    const RAZORPAY_KEY = import.meta.env.VITE_RAZORPAY_KEY_ID || "";
    if (!RAZORPAY_KEY || RAZORPAY_KEY.includes("REPLACE_WITH")) {
      reject(new Error("Razorpay key not configured. Set VITE_RAZORPAY_KEY_ID in your .env file."));
      return;
    }

    let settled = false;
    const settle = (fn: () => void) => { if (!settled) { settled = true; fn(); } };

    const rzp = new window.Razorpay({
      key: RAZORPAY_KEY,
      amount: opts.amount * 100,
      currency: "INR",
      name: "The John Fitness",
      description: `${opts.planName} Membership`,
      prefill: { name: opts.userName || "", email: opts.userEmail || "", contact: opts.userPhone || "" },
      notes: { plan: opts.planName },
      theme: { color: "#39ff14" },
      handler: (response: RazorpayResponse) => settle(() => resolve(response.razorpay_payment_id)),
      modal: { ondismiss: () => settle(() => reject(new Error("cancelled"))) },
    });

    rzp.on("payment.failed", (response: any) => {
      // Don't settle — let the user retry inside the same modal
      console.warn("[Razorpay payment failed]", response.error?.description);
    });

    // Safety net: if the modal becomes unresponsive (tab backgrounded, browser
    // quirk, user never explicitly dismisses) the caller would otherwise hang
    // forever with payLoading stuck true. Time out after 10 minutes.
    setTimeout(() => settle(() => reject(new Error("timeout"))), 10 * 60 * 1000);

    rzp.open();
  });
}
