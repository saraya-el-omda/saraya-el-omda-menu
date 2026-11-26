import { useEffect, useMemo, useState } from 'react';
import { ShoppingBag, ArrowLeft, MessageCircle, TicketPercent } from 'lucide-react';
import {
  MenuItem,
  PromoCode,
  PublicRestaurantSettings,
  RESTAURANT_INFO,
  WEIGHT_LABELS,
  WeightVariants,
} from './data/menuData';
import {
  CartItem,
  calculatePromoDiscount,
  fetchPublicMenu,
  getInitialMenuSnapshot,
  normalizeEgyptWhatsAppPhone,
  shareRestaurantMenu,
} from './utils/gasApi';
import {
  CustomerLocation,
  captureCustomerGPS,
  loadCustomerProfile,
  saveCustomerProfile,
} from './utils/gps';
import { formatEGP } from './utils/arabicSearch';
import { PWAInstallControl } from './components/PWAInstallControl';
import { Header } from './components/Header';
import { HeroSection } from './components/HeroSection';
import { MenuSection } from './components/MenuSection';
import { WeightModal } from './components/WeightModal';
import { CartDrawer } from './components/CartDrawer';
import { OrderTrackerModal } from './components/OrderTrackerModal';
import { Footer } from './components/Footer';
import { OfflineIndicator } from './components/OfflineIndicator';
import { OmdaConcierge } from './components/OmdaConcierge';
import { isLiveActiveCoupon } from './utils/conciergeEngine';

const CART_STORAGE_KEY = 'saraya_customer_cart_v1';

export default function App() {
  // Instant synchronous Stale-While-Revalidate hydration (< 5ms, zero blocking spinner)
  const initialSnapshot = useMemo(() => getInitialMenuSnapshot(), []);
  const [menuItems, setMenuItems] = useState<MenuItem[]>(initialSnapshot.items);
  // Strictly empty initial state for promos — populated ONLY from live Google Sheets
  const [promos, setPromos] = useState<PromoCode[]>([]);
  const [settings, setSettings] = useState<PublicRestaurantSettings>(initialSnapshot.settings);
  const [isSyncingMenu, setIsSyncingMenu] = useState<boolean>(true);

  const [selectedCategory, setSelectedCategory] = useState<string>('الكل');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [appliedPromoCode, setAppliedPromoCode] = useState<string>('');
  const [toastMessage, setToastMessage] = useState<string>('');
  const [activeWeightItem, setActiveWeightItem] = useState<MenuItem | null>(null);
  const [activeWeightPreselect, setActiveWeightPreselect] = useState<
    keyof WeightVariants | undefined
  >(undefined);
  const [isCartOpen, setIsCartOpen] = useState<boolean>(false);
  const [isConciergeOpen, setIsConciergeOpen] = useState<boolean>(false);
  const [isTrackerOpen, setIsTrackerOpen] = useState<boolean>(false);
  const [trackerPrefill, setTrackerPrefill] = useState<{ orderId: string; phoneLast4: string }>({
    orderId: '',
    phoneLast4: '',
  });

  // Shared Zero-Cost GPS Delivery Location State (Top Location Bar <-> Cart Checkout)
  const [customerLocation, setCustomerLocation] = useState<CustomerLocation | null>(() => {
    const profile = loadCustomerProfile();
    return profile?.location || null;
  });
  const [gpsLoading, setGpsLoading] = useState<boolean>(false);
  const [gpsError, setGpsError] = useState<string>('');

  const [cart, setCart] = useState<CartItem[]>(() => {
    try {
      const saved = localStorage.getItem(CART_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as CartItem[];
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // Ignore storage read errors
    }
    return [];
  });

  // Silent background revalidation from Google Sheets
  useEffect(() => {
    let active = true;
    setIsSyncingMenu(true);
    fetchPublicMenu()
      .then((payload) => {
        if (!active) return;
        if (payload.items.length > 0) setMenuItems(payload.items);
        if (payload.source === 'live') {
          setPromos(
            Array.isArray(payload.promos)
              ? payload.promos.filter(isLiveActiveCoupon)
              : []
          );
        } else {
          setPromos([]);
        }
        setSettings(payload.settings);
      })
      .catch(() => {
        // Keep cached/bundled snapshot silently on network error
      })
      .finally(() => {
        if (active) setIsSyncingMenu(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
    } catch {
      // Ignore storage quota errors
    }
  }, [cart]);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(''), 3400);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  const handleCaptureLocation = async () => {
    if (gpsLoading) return;
    setGpsError('');
    setGpsLoading(true);
    try {
      const loc = await captureCustomerGPS(settings);
      setCustomerLocation(loc);
      const existing = loadCustomerProfile();
      saveCustomerProfile({
        name: existing?.name || '',
        phone: existing?.phone || '',
        district: existing?.district || 'المجاورة العاشرة',
        addressDetails: existing?.addressDetails || '',
        location: loc,
      });
      setToastMessage(`تم تحديد موقع التوصيل بدقة (~${loc.distanceKm} كم من الفرع)`);
    } catch (err) {
      setGpsError(
        err instanceof Error
          ? err.message
          : 'تعذر تحديد الموقع تلقائياً. يمكنك إكمال الطلب بكتابة العنوان يدوياً.'
      );
    } finally {
      setGpsLoading(false);
    }
  };

  const handleClearLocation = () => {
    setCustomerLocation(null);
    setGpsError('');
    const existing = loadCustomerProfile();
    if (existing) {
      saveCustomerProfile({
        ...existing,
        location: null,
      });
    }
  };

  const handleAddFixedItem = (item: MenuItem, quantity = 1, note = '') => {
    const cartKey = `${item.id}::fixed`;
    setCart((prev) => {
      const existing = prev.find((c) => c.cartKey === cartKey);
      if (existing) {
        return prev.map((c) =>
          c.cartKey === cartKey
            ? {
                ...c,
                quantity: c.quantity + quantity,
                note: note || c.note,
              }
            : c
        );
      }
      return [
        ...prev,
        {
          cartKey,
          itemId: item.id,
          name: item.name,
          category: item.category,
          unitPrice: item.price ?? 0,
          quantity,
          note: note || undefined,
          image: item.image,
        },
      ];
    });
  };

  const handleAddWeightItem = (
    item: MenuItem,
    weightKey: keyof WeightVariants,
    unitPrice: number,
    quantity: number,
    note: string
  ) => {
    const cartKey = `${item.id}::${weightKey}`;
    setCart((prev) => {
      const existing = prev.find((c) => c.cartKey === cartKey);
      if (existing) {
        return prev.map((c) =>
          c.cartKey === cartKey
            ? {
                ...c,
                quantity: c.quantity + quantity,
                note: note || c.note,
              }
            : c
        );
      }
      return [
        ...prev,
        {
          cartKey,
          itemId: item.id,
          name: item.name,
          category: item.category,
          weightKey,
          weightLabel: WEIGHT_LABELS[weightKey],
          unitPrice,
          quantity,
          note,
          image: item.image,
        },
      ];
    });
  };

  const handleUpdateQty = (cartKey: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) =>
          item.cartKey === cartKey
            ? { ...item, quantity: item.quantity + delta }
            : item
        )
        .filter((item) => item.quantity > 0)
    );
  };

  const handleRemoveItem = (cartKey: string) => {
    setCart((prev) => prev.filter((item) => item.cartKey !== cartKey));
  };

  const handleUpdateItemNote = (cartKey: string, note: string) => {
    setCart((prev) =>
      prev.map((item) => (item.cartKey === cartKey ? { ...item, note } : item))
    );
  };

  const handleClearCart = () => {
    setCart([]);
  };

  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
  const subtotalAmount = cart.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity,
    0
  );

  const activePromoEval = appliedPromoCode
    ? calculatePromoDiscount(appliedPromoCode, subtotalAmount, promos)
    : null;
  const activeDiscount = activePromoEval?.valid ? activePromoEval.discountAmount : 0;
  const totalAfterDiscount = Math.max(0, subtotalAmount - activeDiscount);

  const handleQuickApplyPromo = (code: string) => {
    const cleanCode = code.trim().toUpperCase();
    setAppliedPromoCode(cleanCode);
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        void navigator.clipboard.writeText(cleanCode);
      }
    } catch {
      // Ignore clipboard denial
    }

    const promoObj = promos.find((p) => p.code.trim().toUpperCase() === cleanCode);
    const evalNow = calculatePromoDiscount(cleanCode, subtotalAmount, promos);
    if (evalNow.valid) {
      setToastMessage(`تم نسخ وتفعيل كود ${cleanCode} — وفّرت ${formatEGP(evalNow.discountAmount)}!`);
    } else if (promoObj) {
      const valueText =
        promoObj.discountType === 'PERCENT'
          ? `${promoObj.value}%`
          : `${promoObj.value} ج.م`;
      const minText =
        promoObj.minOrder && promoObj.minOrder > 0
          ? ` عند الوصول إلى ${promoObj.minOrder} ج.م`
          : '';
      setToastMessage(`تم نسخ وحفظ كود ${cleanCode} بالسلة (خصم ${valueText}${minText})`);
    } else {
      setToastMessage(`تم نسخ الكود ${cleanCode}`);
    }
  };

  const handleOpenOrderTracker = (orderId = '', phoneLast4 = '') => {
    setTrackerPrefill({ orderId, phoneLast4 });
    setIsTrackerOpen(true);
  };

  const handleOpenItemDetails = (
    item: MenuItem,
    initialWeight?: keyof WeightVariants
  ) => {
    setActiveWeightPreselect(initialWeight);
    setActiveWeightItem(item);
  };

  const handleShareMenu = async () => {
    const status = await shareRestaurantMenu();
    if (status === 'copied') {
      setToastMessage('تم نسخ رابط المنيو بنجاح! يمكنك مشاركته الآن');
    }
  };

  const safeWhatsAppNumber = normalizeEgyptWhatsAppPhone(settings.whatsappNumber);

  const handleScrollToOffers = () => {
    setSelectedCategory('الكل');
    setSearchQuery('');
    window.requestAnimationFrame(() => {
      const target =
        document.getElementById('daily-offers-section') ||
        document.getElementById('menu-catalog');
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  };

  return (
    <div className="min-h-screen bg-[#0B0B0C] text-[#F8F6F0] flex flex-col">
      {/* Slim Dismissible Top PWA Banner (renders ONLY on beforeinstallprompt) */}
      <PWAInstallControl />

      <Header
        cartCount={totalItems}
        settings={settings}
        onOpenCart={() => setIsCartOpen(true)}
        onOpenTracker={() => handleOpenOrderTracker()}
      />

      <main className="flex-1 pb-28 sm:pb-24">
        <HeroSection
          settings={settings}
          customerLocation={customerLocation}
          gpsLoading={gpsLoading}
          gpsError={gpsError}
          onCaptureLocation={() => void handleCaptureLocation()}
          onSelectCategory={setSelectedCategory}
          onScrollToOffers={handleScrollToOffers}
          onOpenConcierge={() => setIsConciergeOpen(true)}
          onShareMenu={() => void handleShareMenu()}
        />

        <MenuSection
          items={menuItems}
          isSyncingMenu={isSyncingMenu}
          promos={promos}
          appliedPromoCode={appliedPromoCode}
          onQuickApplyPromo={handleQuickApplyPromo}
          selectedCategory={selectedCategory}
          onSelectCategory={setSelectedCategory}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          cart={cart}
          onAddFixedItem={(item) => handleAddFixedItem(item, 1, '')}
          onAddWeightItem={handleAddWeightItem}
          onUpdateCartQty={handleUpdateQty}
          onOpenItemDetails={handleOpenItemDetails}
        />
      </main>

      <Footer />

      {/* Golden Toast Notification */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="sheet-up fixed top-16 inset-x-4 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 z-50 max-w-md rounded-xl bg-[#18181B] border border-[#D4AF37]/75 px-4 py-3 shadow-2xl shadow-black/80 flex items-center gap-2.5 text-xs sm:text-sm font-bold text-[#F3E5AB]"
        >
          <TicketPercent className="w-4 h-4 text-[#D4AF37] shrink-0" aria-hidden="true" />
          <span className="leading-snug">{toastMessage}</span>
        </div>
      )}

      {/* Desktop-Only Floating WhatsApp Quick Button (Left side, zero overlap with right-side Concierge or Cart Bar) */}
      {!isCartOpen && !isConciergeOpen && (
        <a
          href={`https://wa.me/${safeWhatsAppNumber}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`تواصل عبر واتساب ${RESTAURANT_INFO.whatsappDisplay}`}
          title={`واتساب الطلبات: ${RESTAURANT_INFO.whatsappDisplay}`}
          className={`hidden md:flex fixed left-6 z-30 w-11 h-11 rounded-full bg-[#25D366]/90 hover:bg-[#25D366] text-[#052110] shadow-xl shadow-black/50 items-center justify-center transition-[bottom,transform] duration-200 ${
            totalItems > 0 ? 'bottom-24' : 'bottom-6'
          }`}
        >
          <MessageCircle className="w-5 h-5" aria-hidden="true" />
        </a>
      )}

      {/* Smart Floating Cart Bar (Smooth entrance, visible ONLY when cart has items, auto-hidden when Cart or Concierge is open) */}
      {totalItems > 0 && !isCartOpen && !isConciergeOpen && (
        <div className="sheet-up fixed bottom-3 inset-x-3 sm:inset-x-auto sm:left-6 sm:w-96 z-30">
          <button
            type="button"
            onClick={() => setIsCartOpen(true)}
            className="btn-royal-gold w-full min-h-[54px] px-4 sm:px-5 py-3 rounded-2xl active:scale-[0.99] shadow-2xl shadow-black/80 flex items-center justify-between gap-3 transition-transform cursor-pointer"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <ShoppingBag className="w-5 h-5 shrink-0" aria-hidden="true" />
              <span className="font-display font-extrabold text-xs sm:text-sm truncate">
                {totalItems} {totalItems === 1 ? 'صنف' : 'أصناف'} •{' '}
                <span className="tabular-nums font-black">
                  {formatEGP(totalAfterDiscount)}
                </span>
              </span>
            </div>

            <span className="flex items-center gap-1 font-display font-black text-xs sm:text-sm whitespace-nowrap shrink-0">
              <span>إتمام الطلب</span>
              <ArrowLeft className="w-4 h-4 shrink-0" aria-hidden="true" />
            </span>
          </button>
        </div>
      )}

      {/* Zero-API Live-Data Smart Concierge («مساعد العمدة الذكي») */}
      <OmdaConcierge
        items={menuItems}
        promos={promos}
        settings={settings}
        cartCount={totalItems}
        isCartOpen={isCartOpen}
        isOpen={isConciergeOpen}
        onOpenChange={setIsConciergeOpen}
        onAddFixedItem={(item) => handleAddFixedItem(item, 1, '')}
        onOpenWeightModal={setActiveWeightItem}
        onNotify={setToastMessage}
      />

      <WeightModal
        item={activeWeightItem}
        initialWeight={activeWeightPreselect}
        onClose={() => {
          setActiveWeightItem(null);
          setActiveWeightPreselect(undefined);
        }}
        onAddWeight={handleAddWeightItem}
        onAddFixed={handleAddFixedItem}
      />

      <CartDrawer
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        cart={cart}
        promos={promos}
        settings={settings}
        customerLocation={customerLocation}
        gpsLoading={gpsLoading}
        gpsError={gpsError}
        onCaptureLocation={() => void handleCaptureLocation()}
        onClearLocation={handleClearLocation}
        appliedPromoCode={appliedPromoCode}
        onAppliedPromoChange={setAppliedPromoCode}
        onUpdateQty={handleUpdateQty}
        onRemoveItem={handleRemoveItem}
        onUpdateItemNote={handleUpdateItemNote}
        onClearCart={handleClearCart}
        onOpenOrderTracker={(orderId, phoneLast4) =>
          handleOpenOrderTracker(orderId, phoneLast4)
        }
      />

      <OrderTrackerModal
        isOpen={isTrackerOpen}
        onClose={() => setIsTrackerOpen(false)}
        initialOrderId={trackerPrefill.orderId}
        initialPhoneLast4={trackerPrefill.phoneLast4}
      />

      <OfflineIndicator />
    </div>
  );
}
