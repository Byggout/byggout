import React, { useEffect, useMemo, useState } from "react";

// -----------------------------
// Byggout – MVP with Supabase Auth (magic link), RLS-ready, basic Admin tools
// -----------------------------
// What this version adds:
// - Supabase Auth (email magic-link) + session state
// - Listings are tied to seller_id (user id)
// - Buttons to edit/delete own listing (client-side demo)
// - Simple Admin tools: mark as featured/hide (requires is_admin in JWT; see SQL below)
// - RLS SQL policies for secure access (copy/paste to Supabase)
//
// Setup steps:
// 1) npm i @supabase/supabase-js
// 2) .env (Vite):
//    VITE_SUPABASE_URL=...
//    VITE_SUPABASE_ANON_KEY=...
//    VITE_STRIPE_PK=...    (optional)
// 3) Create Storage bucket `listing-images` (public)
// 4) Run SQL at bottom to create table + policies
// 5) In Supabase Auth → turn on Email magic link

import { createClient } from "@supabase/supabase-js";
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const stripePk = import.meta.env.VITE_STRIPE_PK as string | undefined;
const supabase = supabaseUrl && supabaseAnon ? createClient(supabaseUrl, supabaseAnon) : null;

export default function Byggout() {
  // ---- Auth ----
  const [user, setUser] = useState<any | null>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [showAuth, setShowAuth] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    (async () => {
      const { data } = await supabase.auth.getSession();
      setUser(data.session?.user ?? null);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub?.subscription.unsubscribe();
  }, []);

  const signIn = async () => {
    if (!supabase) return alert("Saknar Supabase-konfig.");
    if (!authEmail) return alert("Skriv in din e-post.");
    const { error } = await supabase.auth.signInWithOtp({ email: authEmail, options: { emailRedirectTo: window.location.origin } });
    if (error) return alert(error.message);
    alert("Kolla din e-post för en magisk inloggningslänk.");
    setShowAuth(false);
  };
  const signOut = async () => { await supabase?.auth.signOut(); };

  // ---- Listings state ----
  const [listings, setListings] = useState<Array<Listing>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ---- UI state ----
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Alla");
  const [condition, setCondition] = useState("Alla");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [sort, setSort] = useState("Nyast");
  const [selected, setSelected] = useState<Listing | null>(null);
  const [offerValue, setOfferValue] = useState<string>("");
  const [bidValue, setBidValue] = useState<string>("");
  const [showCreate, setShowCreate] = useState(false);

  // ---- Create form state ----
  const [form, setForm] = useState<CreateForm>({
    title: "",
    price: "",
    location: "",
    condition: "Ny/obruten",
    category: "Virke",
    quantity: "",
    image: "",
    imageFile: undefined,
    saleMode: "fixed",
    description: "",
    brand: "",
    model: "",
    dimensions: "",
    cert: "",
    docsUrl: "",
    year: "",
  });

  // ---- Load listings ----
  useEffect(() => {
    (async () => {
      setLoading(true); setError(null);
      try {
        if (!supabase) { setListings(demoListings); return; }
        const { data, error } = await supabase
          .from("listings")
          .select("*")
          .eq("hidden", false)
          .order("featured", { ascending: false })
          .order("posted_at", { ascending: false })
          .limit(200);
        if (error) throw error;
        setListings((data || []).map(fromRow));
      } catch (e: any) {
        setError(e.message || String(e));
        setListings(demoListings);
      } finally { setLoading(false); }
    })();
  }, [user]);

  const categories = ["Alla","Virke","Skivmaterial","Isolering","Plattsättning","Fönster & dörrar","El/VS"]; 
  const conditions = ["Alla","Ny/obruten","Som nytt","Bra skick","Nyskick"];

  const filtered = useMemo(() => {
    let items = [...listings];
    if (query.trim()) {
      const q = query.toLowerCase();
      items = items.filter(i => i.title.toLowerCase().includes(q) || i.location.toLowerCase().includes(q) || i.category.toLowerCase().includes(q));
    }
    if (category !== "Alla") items = items.filter(i => i.category === category);
    if (condition !== "Alla") items = items.filter(i => i.condition === condition);
    const min = Number(minPrice); if (!Number.isNaN(min) && minPrice !== "") items = items.filter(i => i.price >= min);
    const max = Number(maxPrice); if (!Number.isNaN(max) && maxPrice !== "") items = items.filter(i => i.price <= max);
    if (sort === "Lägsta pris") items.sort((a,b)=>a.price-b.price);
    if (sort === "Högsta pris") items.sort((a,b)=>b.price-a.price);
    if (sort === "Nyast") items.sort((a,b)=>Number(b.postedAt)-Number(a.postedAt));
    return items;
  }, [listings, query, category, condition, minPrice, maxPrice, sort]);

  const resetCreateForm = () => setForm({ title:"", price:"", location:"", condition:"Ny/obruten", category:"Virke", quantity:"", image:"", imageFile:undefined, saleMode:"fixed", description:"", brand:"", model:"", dimensions:"", cert:"", docsUrl:"", year:"" });

  // ---- Create listing (requires auth) ----
  const handleCreate = async () => {
    if (!user) return alert("Logga in för att publicera.");
    if (!form.title || !form.price || !form.location) return alert("Fyll i titel, pris och plats.");
    const priceNum = Number(form.price); if (Number.isNaN(priceNum) || priceNum < 0) return alert("Ogiltigt pris.");

    let imageUrl = form.image.trim();
    try {
      if (supabase && form.imageFile) {
        const ext = form.imageFile.name.split(".").pop() || "jpg";
        const path = `${user.id}/${Date.now()}.${ext}`;
        const { data: up, error: upErr } = await supabase.storage.from("listing-images").upload(path, form.imageFile, { upsert:false });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from("listing-images").getPublicUrl(up.path);
        imageUrl = pub.publicUrl;
      }
    } catch (e: any) { console.warn("Image upload failed:", e?.message || e); }

    const newListing: Listing = {
      id: String(Date.now()),
      sellerId: user?.id,
      title: form.title.trim(), price: priceNum, location: form.location.trim(), condition: form.condition, category: form.category,
      quantity: form.quantity.trim() || "", image: imageUrl || placeholderImage(form.category), postedAt: new Date(), description: form.description.trim(),
      saleMode: form.saleMode,
      ...(form.saleMode === "auction" ? { currentBid: 0, bidDeadline: new Date(Date.now()+3*24*60*60*1000) } : {}),
      ...(form.saleMode === "offer" ? { minAcceptable: Math.floor(priceNum*0.7) } : {}),
      materialpass: { brand: form.brand || undefined, model: form.model || undefined, dimensions: form.dimensions || undefined, cert: form.cert || undefined, docsUrl: form.docsUrl || undefined, year: form.year ? Number(form.year) : undefined },
      featured: false, hidden: false,
    };

    setListings(prev => [newListing, ...prev]);
    setShowCreate(false);

    if (supabase) {
      const { error } = await supabase.from("listings").insert(toRow(newListing));
      if (error) console.error(error.message);
    }
    resetCreateForm();
  };

  // ---- Edit/Delete own listing (client demo; server enforced by RLS) ----
  const canEdit = (l: Listing) => user && l.sellerId === user.id;
  const removeListing = async (l: Listing) => {
    if (!canEdit(l)) return alert("Endast ägare kan ta bort.");
    if (!confirm("Ta bort annons?")) return;
    setListings(prev => prev.filter(x => x.id !== l.id));
    if (supabase) {
      const { error } = await supabase.from("listings").delete().eq("id", l.rowId);
      if (error) alert(error.message);
    }
  };

  // ---- Admin actions (requires is_admin=true in JWT) ----
  const isAdmin = !!user?.app_metadata?.is_admin || !!user?.user_metadata?.is_admin; // set via Supabase dashboard or Edge Function
  const adminUpdate = async (l: Listing, patch: Partial<Listing>) => {
    if (!isAdmin) return alert("Endast admin.");
    const updated = { ...l, ...patch };
    setListings(prev => prev.map(x => x.id === l.id ? updated : x));
    if (supabase) {
      const { error } = await supabase.from("listings").update({ featured: !!updated.featured, hidden: !!updated.hidden }).eq("id", l.rowId);
      if (error) alert(error.message);
    }
  };

  // ---- Stripe checkout (placeholder) ----
  const buyNow = async (item: Listing) => {
    if (!stripePk) { alert("Köp nu kräver Stripe – sätt VITE_STRIPE_PK och backend."); return; }
    alert("Demo: här skulle vi redirecta till Stripe Checkout.");
  };

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur border-b">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-white font-bold">BO</span>
            <span className="font-semibold text-lg">Byggout</span>
          </div>
          <div className="flex-1" />
          {user ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="hidden md:inline text-neutral-600">{user.email}</span>
              <button onClick={()=>setShowCreate(true)} className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-sm hover:bg-emerald-700">Lägg upp annons</button>
              <button onClick={signOut} className="px-3 py-2 rounded-xl border">Logga ut</button>
            </div>
          ) : (
            <button onClick={()=>setShowAuth(true)} className="px-3 py-2 rounded-xl border text-sm hover:bg-neutral-100">Logga in</button>
          )}
        </div>
      </header>

      {/* Hero / Search */}
      <section className="bg-gradient-to-b from-emerald-50 to-transparent">
        <div className="mx-auto max-w-7xl px-4 py-6 md:py-10">
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Köp & sälj överblivet byggmaterial</h1>
          <p className="mt-1 text-neutral-600">Fast pris som standard. Budgivning och ge-bud som valbara lägen. Materialpass för tryggt återbruk.</p>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-12 gap-3">
            <div className="md:col-span-5">
              <input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Sök material, plats, kategori…" className="w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
            <div className="md:col-span-3">
              <select value={category} onChange={(e)=>setCategory(e.target.value)} className="w-full rounded-xl border px-3 py-2">{["Alla","Virke","Skivmaterial","Isolering","Plattsättning","Fönster & dörrar","El/VS"].map(c=> <option key={c}>{c}</option>)}</select>
            </div>
            <div className="md:col-span-2">
              <select value={condition} onChange={(e)=>setCondition(e.target.value)} className="w-full rounded-xl border px-3 py-2">{["Alla","Ny/obruten","Som nytt","Bra skick","Nyskick"].map(c=> <option key={c}>{c}</option>)}</select>
            </div>
            <div className="md:col-span-2">
              <select value={sort} onChange={(e)=>setSort(e.target.value)} className="w-full rounded-xl border px-3 py-2">{["Nyast","Lägsta pris","Högsta pris"].map(c=> <option key={c}>{c}</option>)}</select>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2 text-sm">
            <span className="text-neutral-600">Pris:</span>
            <input inputMode="numeric" value={minPrice} onChange={(e)=>setMinPrice(e.target.value)} placeholder="Min" className="w-20 rounded-lg border px-2 py-1" />
            <span>–</span>
            <input inputMode="numeric" value={maxPrice} onChange={(e)=>setMaxPrice(e.target.value)} placeholder="Max" className="w-20 rounded-lg border px-2 py-1" />
            {query || category!=="Alla" || condition!=="Alla" || minPrice || maxPrice ? (
              <button onClick={()=>{ setQuery(""); setCategory("Alla"); setCondition("Alla"); setMinPrice(""); setMaxPrice(""); setSort("Nyast"); }} className="ml-2 text-emerald-700 hover:underline">Rensa filter</button>
            ) : null}
          </div>
        </div>
      </section>

      {/* Content */}
      <main className="mx-auto max-w-7xl px-4 pb-16 grid grid-cols-1 lg:grid-cols-12 gap-6">
        <aside className="lg:col-span-3">
          <div className="sticky top-24 space-y-4">
            <div className="rounded-2xl border bg-white p-4">
              <h3 className="font-medium">Så funkar det</h3>
              <ol className="mt-2 space-y-2 text-sm text-neutral-700 list-decimal list-inside">
                <li>Välj annonsläge</li>
                <li>Köparen köper direkt eller lägger bud</li>
                <li>Boka hämtning – klart</li>
              </ol>
            </div>
            {isAdmin && (
              <div className="rounded-2xl border bg-white p-4">
                <h3 className="font-medium">Admin (demo)</h3>
                <p className="text-sm text-neutral-600">Klicka en annons → markera "Featured"/"Dölj" i detaljvyn.</p>
              </div>
            )}
          </div>
        </aside>

        <section className="lg:col-span-9">
          <div className="flex items-center justify-between mb-2">
            {loading ? <p className="text-sm text-neutral-600">Laddar annonser…</p> : <p className="text-sm text-neutral-600">{filtered.length} annonser</p>}
            {!user && <button onClick={()=>setShowAuth(true)} className="md:hidden px-3 py-2 rounded-xl border text-sm">Logga in</button>}
            {user && <button onClick={()=>setShowCreate(true)} className="md:hidden px-3 py-2 rounded-xl bg-emerald-600 text-white text-sm">Lägg upp annons</button>}
          </div>

          {error && <div className="mb-3 text-sm text-red-600">{error}</div>}

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map(item => (
              <article key={item.id} className="group rounded-2xl border bg-white overflow-hidden hover:shadow-sm transition">
                <div className="relative aspect-[4/3] overflow-hidden">
                  <img src={item.image} alt={item.title} className="h-full w-full object-cover group-hover:scale-[1.02] transition" />
                  <div className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-1 text-xs"><span>{item.category}</span></div>
                  <Badge saleMode={item.saleMode} />
                  {item.featured && <span className="absolute left-2 bottom-2 rounded-full bg-yellow-400 text-black text-xs px-2 py-1">Featured</span>}
                </div>
                <div className="p-4">
                  <h3 className="font-medium leading-snug line-clamp-2">{item.title}</h3>
                  <div className="mt-1 text-sm text-neutral-600">{item.location}</div>
                  <CardPricing item={item} />
                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    <button onClick={()=>{ setSelected(item); setOfferValue(""); setBidValue(""); }} className="px-3 py-2 rounded-xl bg-neutral-900 text-white text-sm hover:bg-black">{item.saleMode === "fixed" ? "Köp nu" : item.saleMode === "auction" ? "Lägg bud" : "Ge bud"}</button>
                    {canEdit(item) && <button onClick={()=>removeListing(item)} className="px-3 py-2 rounded-xl border text-sm hover:bg-neutral-100">Ta bort</button>}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>

      {/* Detail Modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/30 p-2 md:p-6" onClick={()=>setSelected(null)}>
          <div className="w-full max-w-3xl rounded-2xl bg-white overflow-hidden shadow-xl" onClick={(e)=>e.stopPropagation()}>
            <div className="grid md:grid-cols-2">
              <img src={selected.image} alt={selected.title} className="h-60 md:h-full w-full object-cover" />
              <div className="p-4 md:p-6">
                <h3 className="text-xl font-semibold leading-snug">{selected.title}</h3>
                <div className="mt-1 text-neutral-600">{selected.location}</div>
                <div className="mt-3"><DetailPricing item={selected} /></div>
                <div className="mt-2 text-sm text-neutral-700">{selected.description}</div>

                <div className="mt-4">
                  <h4 className="font-medium">Materialpass</h4>
                  <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
                    {Object.entries(selected.materialpass || {}).length === 0 && (<div className="col-span-2 text-neutral-500">Ingen info angiven</div>)}
                    {Object.entries(selected.materialpass || {}).map(([k,v]) => (<InfoBox key={k} label={prettyLabel(k)} value={String(v)} />))}
                  </dl>
                </div>

                {selected.saleMode === "fixed" && (
                  <div className="mt-4 flex items-center gap-2">
                    <button onClick={()=>buyNow(selected)} className="px-4 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700">Köp nu för {formatCurrency(selected.price)}</button>
                    <button className="px-4 py-2 rounded-xl border hover:bg-neutral-100">Fråga säljaren</button>
                  </div>
                )}
                {selected.saleMode === "offer" && (
                  <div className="mt-4 flex items-center gap-2">
                    <input inputMode="numeric" className="w-40 rounded-xl border px-3 py-2" placeholder="Ditt bud (SEK)" value={offerValue} onChange={(e)=>setOfferValue(e.target.value)} />
                    <button className="px-4 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700">Skicka bud</button>
                    {typeof selected.minAcceptable === "number" && (<span className="text-xs text-neutral-500">Riktmärke: ≥ {formatCurrency(selected.minAcceptable)}</span>)}
                  </div>
                )}
                {selected.saleMode === "auction" && (
                  <div className="mt-4 space-y-2">
                    <div className="text-sm">Aktuellt bud: <strong>{formatCurrency(selected.currentBid || 0)}</strong> · Slutar {formatDateTime(selected.bidDeadline!)}</div>
                    <div className="flex items-center gap-2">
                      <input inputMode="numeric" className="w-40 rounded-xl border px-3 py-2" placeholder="Ditt bud (SEK)" value={bidValue} onChange={(e)=>setBidValue(e.target.value)} />
                      <button className="px-4 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700">Lägg bud</button>
                    </div>
                  </div>
                )}

                <div className="mt-4 flex items-center gap-2 flex-wrap">
                  <button className="px-4 py-2 rounded-xl border hover:bg-neutral-100">Dela</button>
                  {canEdit(selected) && <button onClick={()=>removeListing(selected)} className="px-4 py-2 rounded-xl border hover:bg-neutral-100">Ta bort</button>}
                  {isAdmin && (
                    <>
                      <button onClick={()=>adminUpdate(selected, { featured: !selected.featured })} className="px-4 py-2 rounded-xl border hover:bg-neutral-100">{selected.featured ? "Ta bort Featured" : "Markera Featured"}</button>
                      <button onClick={()=>adminUpdate(selected, { hidden: !selected.hidden })} className="px-4 py-2 rounded-xl border hover:bg-neutral-100">{selected.hidden ? "Visa" : "Dölj"}</button>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="flex justify-end p-3 border-t"><button onClick={()=>setSelected(null)} className="px-3 py-2 rounded-xl border hover:bg-neutral-100">Stäng</button></div>
          </div>
        </div>
      )}

      {/* Auth Modal */}
      {showAuth && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/30 p-2 md:p-6" onClick={()=>setShowAuth(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white overflow-hidden shadow-xl" onClick={(e)=>e.stopPropagation()}>
            <div className="p-5">
              <h3 className="text-lg font-semibold">Logga in</h3>
              <p className="text-sm text-neutral-600 mt-1">Vi skickar en magisk länk till din e‑post.</p>
              <label className="block mt-4">
                <span className="text-sm text-neutral-700">E‑post</span>
                <input value={authEmail} onChange={(e)=>setAuthEmail(e.target.value)} type="email" className="mt-1 w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder="du@exempel.se" />
              </label>
              <div className="mt-4 flex items-center gap-2">
                <button onClick={signIn} className="px-4 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700">Skicka länk</button>
                <button onClick={()=>setShowAuth(false)} className="px-4 py-2 rounded-xl border hover:bg-neutral-100">Avbryt</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Listing Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/30 p-2 md:p-6" onClick={()=>setShowCreate(false)}>
          <div className="w-full max-w-3xl rounded-2xl bg-white overflow-hidden shadow-xl" onClick={(e)=>e.stopPropagation()}>
            <div className="p-4 md:p-6">
              <h3 className="text-xl font-semibold">Lägg upp annons</h3>
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                <TextInput label="Titel" value={form.title} onChange={(v)=>setForm({...form,title:v})} placeholder="Ex: Gipsskivor 13mm – 24 st" />
                <TextInput label="Pris (SEK)" value={form.price} onChange={(v)=>setForm({...form,price:v})} inputMode="numeric" />
                <TextInput label="Plats" value={form.location} onChange={(v)=>setForm({...form,location:v})} placeholder="Ex: Huddinge, Stockholm" />
                <TextInput label="Mängd" value={form.quantity} onChange={(v)=>setForm({...form,quantity:v})} placeholder="Ex: 120 m²" />
                <SelectInput label="Kategori" value={form.category} onChange={(v)=>setForm({...form,category:v})} options={["Virke","Skivmaterial","Isolering","Plattsättning","Fönster & dörrar","El/VS"]} />
                <SelectInput label="Skick" value={form.condition} onChange={(v)=>setForm({...form,condition:v})} options={["Ny/obruten","Som nytt","Bra skick","Nyskick"]} />
                <SelectInput label="Annonsläge" value={form.saleMode} onChange={(v)=>setForm({...form,saleMode:v as Listing["saleMode"]})} options={["fixed","auction","offer"]} displayMap={{fixed:"Fast pris",auction:"Budgivning",offer:"Ge bud"}} />
                <TextInput label="Bild-URL" value={form.image} onChange={(v)=>setForm({...form,image:v})} placeholder="Klistra in länk (valfritt)" />
                <FileInput label="Eller ladda upp bild" onChange={(file)=>setForm({...form,imageFile:file})} />
                <TextArea label="Beskrivning" value={form.description} onChange={(v)=>setForm({...form,description:v})} className="md:col-span-2" />
              </div>

              <div className="mt-6">
                <h4 className="font-medium">Materialpass (valfritt)</h4>
                <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-3">
                  <TextInput label="Varumärke" value={form.brand} onChange={(v)=>setForm({...form,brand:v})} />
                  <TextInput label="Modell" value={form.model} onChange={(v)=>setForm({...form,model:v})} />
                  <TextInput label="Mått/Dimensioner" value={form.dimensions} onChange={(v)=>setForm({...form,dimensions:v})} />
                  <TextInput label="Certifiering" value={form.cert} onChange={(v)=>setForm({...form,cert:v})} placeholder="CE, EI30, C24…" />
                  <TextInput label="Dokumentationslänk" value={form.docsUrl} onChange={(v)=>setForm({...form,docsUrl:v})} placeholder="URL till datablad" />
                  <TextInput label="År" value={form.year} onChange={(v)=>setForm({...form,year:v})} inputMode="numeric" />
                </div>
              </div>

              <div className="mt-6 flex items-center gap-2">
                <button onClick={handleCreate} className="px-4 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700">Publicera annons</button>
                <button onClick={()=>setShowCreate(false)} className="px-4 py-2 rounded-xl border hover:bg-neutral-100">Avbryt</button>
              </div>
            </div>
            <div className="flex justify-end p-3 border-t"><button onClick={()=>setShowCreate(false)} className="px-3 py-2 rounded-xl border hover:bg-neutral-100">Stäng</button></div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t bg-white">
        <div className="mx-auto max-w-7xl px-4 py-10 grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
          <div>
            <div className="font-semibold">Byggout</div>
            <p className="mt-2 text-neutral-600 max-w-sm">Marknadsplats för byggspill & överskott. Fast pris som standard, budgivning och ge‑bud som val.</p>
          </div>
          <div>
            <div className="font-semibold">Kategorier</div>
            <ul className="mt-2 space-y-1 text-neutral-700">{"Virke,Skivmaterial,Isolering,Plattsättning,Fönster & dörrar,El/VS".split(",").map(c=> <li key={c}><a href="#" className="hover:underline">{c}</a></li>)}</ul>
          </div>
          <div>
            <div className="font-semibold">Hjälp</div>
            <ul className="mt-2 space-y-1 text-neutral-700">
              <li><a href="#" className="hover:underline">Säkra betalningar</a></li>
              <li><a href="#" className="hover:underline">Regler & villkor</a></li>
              <li><a href="#" className="hover:underline">Kontakta oss</a></li>
            </ul>
          </div>
        </div>
      </footer>

      {/* --- SQL: table + RLS policies (copy into Supabase SQL editor) --- */}
      {false && (
        <pre>
{`
-- Enable pgcrypto for gen_random_uuid
create extension if not exists pgcrypto;

create table if not exists public.listings (
  id uuid default gen_random_uuid() primary key,
  seller_id uuid references auth.users(id) on delete cascade,
  title text not null,
  price numeric not null,
  location text not null,
  condition text not null,
  category text not null,
  quantity text,
  image text,
  posted_at timestamptz default now(),
  description text,
  sale_mode text check (sale_mode in ('fixed','auction','offer')) not null,
  current_bid numeric,
  bid_deadline timestamptz,
  min_acceptable numeric,
  materialpass jsonb default '{}'::jsonb,
  featured boolean default false,
  hidden boolean default false
);

alter table public.listings enable row level security;

-- Helper: check admin flag from JWT
create or replace function public.is_admin() returns boolean language sql stable as $$
  select coalesce( (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean,
                   (auth.jwt() -> 'user_metadata' ->> 'is_admin')::boolean,
                   false);
$$;

-- Policies
create policy "read_all_visible" on public.listings for select using (hidden = false or public.is_admin());
create policy "insert_own" on public.listings for insert with check (auth.uid() = seller_id);
create policy "update_own" on public.listings for update using (auth.uid() = seller_id) with check (auth.uid() = seller_id);
create policy "delete_own" on public.listings for delete using (auth.uid() = seller_id);

-- Admin can update featured/hidden
create policy "admin_update" on public.listings for update using (public.is_admin());

-- Example: set seller_id on insert via client (recommended), or via trigger:
-- create function set_seller_id() returns trigger language plpgsql as $$
-- begin new.seller_id := coalesce(new.seller_id, auth.uid()); return new; end; $$;
-- create trigger tr_set_seller_id before insert on public.listings for each row execute procedure set_seller_id();
`}
        </pre>
      )}
    </div>
  );
}

// ---- Small UI helpers ----
function TextInput({ label, value, onChange, placeholder, inputMode, className }: { label: string; value: string; onChange: (v:string)=>void; placeholder?: string; inputMode?: string; className?: string; }) {
  return (
    <label className={`block ${className || ""}`}>
      <span className="text-sm text-neutral-700">{label}</span>
      <input value={value} onChange={(e)=>onChange(e.target.value)} placeholder={placeholder} inputMode={inputMode as any}
        className="mt-1 w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500" />
    </label>
  );
}
function FileInput({ label, onChange }: { label: string; onChange: (f: File | undefined) => void }) {
  return (
    <label className="block">
      <span className="text-sm text-neutral-700">{label}</span>
      <input type="file" accept="image/*" onChange={(e)=>onChange(e.target.files?.[0])} className="mt-1 w-full rounded-xl border px-3 py-2" />
    </label>
  );
}
function TextArea({ label, value, onChange, className }: { label: string; value: string; onChange: (v:string)=>void; className?: string; }) {
  return (
    <label className={`block ${className || ""}`}>
      <span className="text-sm text-neutral-700">{label}</span>
      <textarea value={value} onChange={(e)=>onChange(e.target.value)} rows={4}
        className="mt-1 w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500" />
    </label>
  );
}
function InfoBox({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-neutral-50 p-2 border">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="font-medium break-words">{value}</dd>
    </div>
  );
}
function SelectInput({ label, value, onChange, options, displayMap, className }: { label: string; value: string; onChange: (v:string)=>void; options: string[]; displayMap?: Record<string,string>; className?: string; }) {
  return (
    <label className={`block ${className || ""}`}>
      <span className="text-sm text-neutral-700">{label}</span>
      <select value={value} onChange={(e)=>onChange(e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-2">
        {options.map(opt => <option key={opt} value={opt}>{displayMap?.[opt] || opt}</option>)}
      </select>
    </label>
  );
}
function Badge({ saleMode }: { saleMode: Listing["saleMode"] }) {
  const label = saleMode === "fixed" ? "Fast pris" : saleMode === "auction" ? "Budgivning" : "Ge bud";
  return (<span className="absolute right-2 top-2 rounded-full bg-emerald-600 text-white text-xs px-2 py-1 shadow">{label}</span>);
}
function CardPricing({ item }: { item: Listing }) {
  if (item.saleMode === "fixed") return (<div className="mt-2 flex items-center justify-between"><span className="text-lg font-semibold">{formatCurrency(item.price)}</span><span className="text-xs rounded-full bg-neutral-100 px-2 py-1">{item.condition}</span></div>);
  if (item.saleMode === "offer") return (<div className="mt-2 flex items-center justify-between"><span className="text-sm text-neutral-700">Ge ett bud</span><span className="text-xs rounded-full bg-neutral-100 px-2 py-1">{item.condition}</span></div>);
  return (<div className="mt-2 flex items-center justify-between"><span className="text-sm text-neutral-700">Aktuellt bud: <strong>{formatCurrency(item.currentBid || 0)}</strong></span><span className="text-xs rounded-full bg-neutral-100 px-2 py-1">{item.condition}</span></div>);
}
function DetailPricing({ item }: { item: Listing }) {
  if (item.saleMode === "fixed") return <div className="text-2xl font-bold">{formatCurrency(item.price)}</div>;
  if (item.saleMode === "offer") return (<div className="text-sm">Säljaren önskar bud. Riktpris: <strong>{formatCurrency(item.price)}</strong></div>);
  return (<div className="text-sm">Aktuellt bud: <strong>{formatCurrency(item.currentBid || 0)}</strong> · Slut: <strong>{formatDateTime(item.bidDeadline!)}</strong></div>);
}

// ---- Demo data (fallback) ----
const demoListings: Listing[] = [
  { id:"1", sellerId:"demo", title:"Gipsskivor 13mm – 24 st obrutna paket", price:2400, location:"Huddinge, Stockholm", condition:"Ny/obruten", category:"Skivmaterial", quantity:"~120 m²", image:"https://images.unsplash.com/photo-1519710164239-da123dc03ef4?q=80&w=1200&auto=format&fit=crop", postedAt:new Date("2025-09-18"), description:"Felbeställda gipsskivor av hög kvalitet (13 mm).", saleMode:"fixed", materialpass:{ brand:"Gyproc", year:2025 }, featured:false, hidden:false },
  { id:"2", sellerId:"demo", title:"Reglar C24 45x95 – 80 löpmeter", price:1800, location:"Mölndal, Göteborg", condition:"Bra skick", category:"Virke", quantity:"80 lm", image:"https://images.unsplash.com/photo-1600486913747-55e2d2d46a30?q=80&w=1200&auto=format&fit=crop", postedAt:new Date("2025-09-20"), description:"Överblivet från renovering.", saleMode:"offer", minAcceptable:1500, materialpass:{ woodClass:"C24" }, featured:false, hidden:false },
  { id:"3", sellerId:"demo", title:"Klinker 60x60 – 48 m² (grå matt)", price:4800, location:"Malmö", condition:"Ny/obruten", category:"Plattsättning", quantity:"48 m²", image:"https://images.unsplash.com/photo-1618220179428-22790b461013?q=80&w=1200&auto=format&fit=crop", postedAt:new Date("2025-09-19"), description:"Hel pall kvar från projekt.", saleMode:"auction", currentBid:3600, bidDeadline:new Date("2025-09-27T18:00:00"), materialpass:{ dimensions:"600x600 mm" }, featured:true, hidden:false },
];

// ---- Types & helpers ----

type Listing = {
  id: string;
  rowId?: string; // db row id (uuid) if available
  sellerId?: string | null;
  title: string;
  price: number;
  location: string;
  condition: "Ny/obruten" | "Som nytt" | "Bra skick" | "Nyskick" | string;
  category: string;
  quantity: string;
  image: string;
  postedAt: Date;
  description: string;
  saleMode: "fixed" | "auction" | "offer";
  currentBid?: number;
  bidDeadline?: Date;
  minAcceptable?: number;
  materialpass?: Record<string, string | number | undefined>;
  featured?: boolean;
  hidden?: boolean;
};

type CreateForm = { title:string; price:string; location:string; condition:Listing["condition"]; category:string; quantity:string; image:string; imageFile?:File|undefined; saleMode:Listing["saleMode"]; description:string; brand:string; model:string; dimensions:string; cert:string; docsUrl:string; year:string; };

function formatCurrency(n: number) { return new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK", maximumFractionDigits: 0 }).format(n); }
function formatDateTime(d: Date) { return new Intl.DateTimeFormat("sv-SE", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d); }
function prettyLabel(key: string) { const map: Record<string,string> = { brand:"Varumärke", model:"Modell", dimensions:"Mått", cert:"Certifiering", docsUrl:"Dokumentation", year:"År", woodClass:"Träklass", lambda:"Lambda-värde", uValue:"U-värde", fireClass:"Brandklass", woodTreatment:"Träskydd" }; return map[key] || key; }
function slugify(s: string) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)+/g, ""); }
function placeholderImage(category: string) { if (category === "Virke") return "https://images.unsplash.com/photo-1600486913747-55e2d2d46a30?q=80&w=1200&auto=format&fit=crop"; if (category === "Skivmaterial") return "https://images.unsplash.com/photo-1519710164239-da123dc03ef4?q=80&w=1200&auto=format&fit=crop"; if (category === "Isolering") return "https://images.unsplash.com/photo-1641224396111-2eac6b7f982e?q=80&w=1200&auto=format&fit=crop"; if (category === "Plattsättning") return "https://images.unsplash.com/photo-1618220179428-22790b461013?q=80&w=1200&auto=format&fit=crop"; if (category === "Fönster & dörrar") return "https://images.unsplash.com/photo-1600585154526-990dced4db0d?q=80&w=1200&auto=format&fit=crop"; if (category === "El/VS") return "https://images.unsplash.com/photo-1581093458415-15d9843a1b92?q=80&w=1200&auto=format&fit=crop"; return "https://images.unsplash.com/photo-1523419409543-14f0e1bdd3c3?q=80&w=1200&auto=format&fit=crop"; }

function fromRow(r: any): Listing {
  return {
    id: r.id || String(r.pk || r.slug || r.title),
    rowId: r.id,
    sellerId: r.seller_id || null,
    title: r.title,
    price: Number(r.price),
    location: r.location,
    condition: r.condition,
    category: r.category,
    quantity: r.quantity || "",
    image: r.image || placeholderImage(r.category),
    postedAt: r.posted_at ? new Date(r.posted_at) : new Date(),
    description: r.description || "",
    saleMode: r.sale_mode,
    currentBid: r.current_bid ? Number(r.current_bid) : undefined,
    bidDeadline: r.bid_deadline ? new Date(r.bid_deadline) : undefined,
    minAcceptable: r.min_acceptable ? Number(r.min_acceptable) : undefined,
    materialpass: r.materialpass || {},
    featured: !!r.featured,
    hidden: !!r.hidden,
  };
}
function toRow(l: Listing) {
  return {
    seller_id: l.sellerId,
    title: l.title,
    price: l.price,
    location: l.location,
    condition: l.condition,
    category: l.category,
    quantity: l.quantity,
    image: l.image,
    posted_at: l.postedAt.toISOString(),
    description: l.description,
    sale_mode: l.saleMode,
    current_bid: l.currentBid ?? null,
    bid_deadline: l.bidDeadline ? l.bidDeadline.toISOString() : null,
    min_acceptable: l.minAcceptable ?? null,
    materialpass: l.materialpass ?? {},
    featured: !!l.featured,
    hidden: !!l.hidden,
  };
}
