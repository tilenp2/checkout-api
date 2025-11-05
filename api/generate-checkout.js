// FINAL FRONTEND SCRIPT v2.0
(function() {
  // >>> UPDATED URL TO MATCH THE NEW FILENAME <<<
  const UNIFIED_CHECKOUT_URL = 'https://checkout-api-rosy.vercel.app/api/generate-checkout';

  let latestCart = null;

  function handleCartUpdate(cart) {
    latestCart = cart;
  }

  async function interceptCheckout(e) {
    e.preventDefault();
    const btn = e.target.closest('button, [type="submit"]') || e.target;
    const originalText = btn.innerText || btn.value;
    btn.value ? btn.value = 'Redirecting...' : btn.innerText = 'Redirecting...';
    btn.disabled = true;

    if (!latestCart) {
       try { latestCart = await fetch('/cart.js').then(r => r.json()); } catch(err) { /* ... */ }
    }
    if (!latestCart || latestCart.items.length === 0) {
        alert("Your cart is empty.");
        btn.value ? btn.value = originalText : btn.innerText = originalText;
        btn.disabled = false;
        return;
    }
    const payload = {
      currency: latestCart.currency,
      items: latestCart.items.map(item => ({
        price: item.final_price / 100, 
        quantity: item.quantity,
        title: item.title,
        product_title: item.product_title,
        image: item.image
      }))
    };
    try {
      const res = await fetch(UNIFIED_CHECKOUT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok && data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else {
        throw new Error(data.error || "No checkout URL received");
      }
    } catch (error) {
      console.error("Unified Checkout Error:", error);
      alert("There was an error processing your checkout. Please try again.");
      btn.value ? btn.value = originalText : btn.innerText = originalText;
      btn.disabled = false;
    }
  }

  document.addEventListener('click', function(e) {
    if (e.target.closest('[name="checkout"], .cart__checkout-button, form[action$="/checkout"] [type="submit"]')) {
      interceptCheckout(e);
    }
  });

  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const res = await originalFetch(...args);
    const url = args[0].toString();
    if (url.includes('/cart/add') || url.includes('/cart/change') || url.includes('/cart/update')) {
      fetch('/cart.js').then(r => r.json()).then(handleCartUpdate);
    }
    return res;
  };
  fetch('/cart.js').then(r => r.json()).then(handleCartUpdate);
})();
