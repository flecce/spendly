import { normalize } from './categorize';
import { LANGS, type Lang } from './i18n';
import type { Category } from './schema';

/** Categorical palette (light value → dark-surface step of the same hue). */
export const PALETTE: [light: string, dark: string][] = [
  ['#2a78d6', '#3987e5'], // blue
  ['#eb6834', '#d95926'], // orange
  ['#1baf7a', '#199e70'], // aqua
  ['#eda100', '#c98500'], // yellow
  ['#e87ba4', '#d55181'], // magenta
  ['#008300', '#008300'], // green
  ['#4a3aa7', '#9085e9'], // violet
  ['#e34948', '#e66767'], // red
  ['#898781', '#898781'], // neutral
];

const DARK = new Map(PALETTE.map(([l, d]) => [l.toLowerCase(), d]));
const darkQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

/** Category colours are stored as their light value; this picks the step for the current theme. */
export const themedColor = (hex: string): string =>
  darkQuery?.matches ? (DARK.get(hex.toLowerCase()) ?? hex) : hex;

export const onThemeChange = (fn: () => void): void => darkQuery?.addEventListener('change', fn);

interface Seed {
  icon: string;
  color: string;
  names: Record<Lang, string>;
  /** Brands, chains and other proper nouns: they read the same in every language. */
  shared: string;
  /** Everyday words, one list per language, so the list stays readable. */
  words: Record<Lang, string>;
}

const SEEDS: Seed[] = [
  {
    icon: '🛒',
    color: '#1baf7a',
    names: { en: 'Groceries', it: 'Spesa', es: 'Supermercado', fr: 'Courses', de: 'Lebensmittel' },
    shared:
      'esselunga, coop, conad, lidl, aldi, carrefour, eurospin, despar, penny, pam, iper, bennet, famila, crai, ' +
      'mercadona, dia, eroski, alcampo, auchan, leclerc, intermarche, monoprix, franprix, rewe, edeka, netto, kaufland, ' +
      'tesco, sainsbury, asda, waitrose, walmart, costco, whole foods',
    words: {
      en: 'groceries, grocery, supermarket, market, food shopping, bakery, butcher, greengrocer, fruit, vegetables',
      it: 'spesa, supermercato, alimentari, mercato, panetteria, panificio, forno, macelleria, fruttivendolo, frutta, verdura',
      es: 'compra, supermercado, comestibles, mercado, panadería, carnicería, frutería, fruta, verdura',
      fr: 'courses, supermarché, épicerie, marché, boulangerie, boucherie, primeur, fruits, légumes',
      de: 'einkauf, supermarkt, lebensmittel, markt, bäckerei, metzgerei, obst, gemüse',
    },
  },
  {
    icon: '🍽️',
    color: '#eb6834',
    names: { en: 'Eating out', it: 'Ristoranti e bar', es: 'Restaurantes', fr: 'Restaurants', de: 'Essen gehen' },
    shared:
      'pizza, sushi, ramen, kebab, burger, hamburger, tapas, brunch, mcdonald, mcdonalds, burger king, kfc, starbucks, ' +
      'deliveroo, glovo, just eat, justeat, uber eats, ubereats, lieferando, espresso, cappuccino',
    words: {
      en: 'restaurant, pub, bar, cafe, coffee, breakfast, lunch, dinner, beer, ice cream, takeaway, sandwich, bistro',
      it: 'ristorante, trattoria, osteria, pizzeria, bar, caffè, colazione, cornetto, brioche, pranzo, cena, aperitivo, spritz, birra, gelato, gelateria, asporto, panino',
      es: 'restaurante, bar, cafetería, café, desayuno, almuerzo, cena, cerveza, helado, bocadillo, para llevar',
      fr: 'restaurant, brasserie, bistro, bar, café, petit déjeuner, déjeuner, dîner, apéro, apéritif, bière, glace, sandwich, à emporter',
      de: 'restaurant, kneipe, bar, kaffee, frühstück, mittagessen, abendessen, bier, eis, eisdiele, imbiss, zum mitnehmen',
    },
  },
  {
    icon: '🚗',
    color: '#2a78d6',
    names: { en: 'Transport', it: 'Trasporti', es: 'Transporte', fr: 'Transports', de: 'Verkehr' },
    shared:
      'diesel, esso, shell, repsol, q8, tamoil, metro, tram, taxi, uber, bolt, free now, freenow, cabify, lyft, ' +
      'trenitalia, italo, renfe, sncf, ouigo, deutsche bahn, flixbus, telepass, carsharing, car sharing, share now, scooter',
    words: {
      en: 'fuel, petrol, gas station, train, bus, coach, subway, underground, parking, motorway, toll, car rental, mechanic, garage, service, tyres, tires, car wash',
      it: 'benzina, carburante, gasolio, rifornimento, distributore, treno, autobus, pullman, metropolitana, parcheggio, autostrada, pedaggio, noleggio, monopattino, officina, meccanico, tagliando, revisione, gomme, pneumatici, lavaggio',
      es: 'gasolina, combustible, gasolinera, tren, autobús, aparcamiento, estacionamiento, autopista, peaje, alquiler de coche, taller, mecánico, neumáticos, lavado',
      fr: 'carburant, essence, gazole, station service, train, bus, autocar, parking, autoroute, péage, location de voiture, garage, mécanicien, pneus, lavage',
      de: 'benzin, tanken, tankstelle, kraftstoff, zug, bus, parken, parkhaus, autobahn, maut, vignette, mietwagen, werkstatt, inspektion, reifen, waschanlage',
    },
  },
  {
    icon: '🏠',
    color: '#4a3aa7',
    names: { en: 'Home & bills', it: 'Casa e bollette', es: 'Casa y facturas', fr: 'Logement & factures', de: 'Wohnen & Rechnungen' },
    shared:
      'internet, wifi, tim, vodafone, windtre, iliad, fastweb, movistar, orange, sfr, bouygues, telekom, o2, ' +
      'enel, hera, a2a, iren, edison, endesa, iberdrola, edf, engie, ikea, leroy merlin, obi, bauhaus, brico',
    words: {
      en: 'rent, mortgage, bill, bills, electricity, power, gas, water, phone, mobile, broadband, taxes, insurance, furniture, diy, cleaning, heating, plumber, electrician, laundry',
      it: 'affitto, mutuo, condominio, bolletta, bollette, luce, elettricità, gas, acqua, fibra, telefono, cellulare, ricarica, tari, imu, tasse, assicurazione, arredamento, mobili, bricolage, pulizie, riscaldamento, idraulico, elettricista, lavanderia',
      es: 'alquiler, hipoteca, comunidad, factura, facturas, luz, electricidad, gas, agua, teléfono, móvil, fibra, impuestos, seguro, muebles, bricolaje, limpieza, calefacción, fontanero, electricista, lavandería',
      fr: 'loyer, hypothèque, charges, facture, factures, électricité, gaz, eau, téléphone, mobile, fibre, impôts, assurance, meubles, bricolage, ménage, chauffage, plombier, électricien, blanchisserie',
      de: 'miete, hypothek, nebenkosten, rechnung, rechnungen, strom, gas, wasser, telefon, handy, steuer, steuern, versicherung, möbel, heimwerken, putzen, heizung, klempner, elektriker, wäscherei',
    },
  },
  {
    icon: '💊',
    color: '#e34948',
    names: { en: 'Health & care', it: 'Salute e benessere', es: 'Salud y bienestar', fr: 'Santé & bien-être', de: 'Gesundheit & Pflege' },
    shared: 'spa, yoga, pilates, fitness, wellness, physio, check up',
    words: {
      en: 'pharmacy, chemist, doctor, dentist, hospital, clinic, medicine, medication, optician, glasses, lenses, physiotherapy, psychologist, therapy, vet, gym, hairdresser, barber, beautician, massage',
      it: 'farmacia, medico, dottore, dentista, ospedale, clinica, visita, analisi, esami, medicina, medicinali, farmaco, farmaci, ottico, occhiali, lenti, fisioterapia, fisioterapista, psicologo, terapia, veterinario, palestra, parrucchiere, barbiere, estetista, massaggio',
      es: 'farmacia, médico, dentista, hospital, clínica, consulta, análisis, medicina, medicamento, óptica, gafas, lentillas, fisioterapia, psicólogo, terapia, veterinario, gimnasio, peluquería, barbería, esteticista, masaje',
      fr: 'pharmacie, médecin, dentiste, hôpital, clinique, consultation, analyses, médicament, opticien, lunettes, lentilles, kiné, kinésithérapie, psychologue, thérapie, vétérinaire, salle de sport, coiffeur, barbier, esthétique, massage',
      de: 'apotheke, arzt, zahnarzt, krankenhaus, klinik, untersuchung, medizin, medikament, optiker, brille, kontaktlinsen, physiotherapie, psychologe, therapie, tierarzt, fitnessstudio, friseur, kosmetik, massage',
    },
  },
  {
    icon: '🛍️',
    color: '#e87ba4',
    names: { en: 'Shopping', it: 'Shopping', es: 'Compras', fr: 'Shopping', de: 'Shopping' },
    shared:
      'amazon, ebay, zalando, zara, primark, uniqlo, mango, decathlon, nike, adidas, mediaworld, unieuro, euronics, ' +
      'fnac, el corte ingles, mediamarkt, media markt, saturn, apple store, aliexpress, shein, temu, sephora, douglas, ' +
      'feltrinelli, mondadori, jeans, outlet',
    words: {
      en: 'clothes, clothing, shoes, shirt, trousers, jacket, gift, gifts, book, books, bookshop, electronics, perfume, cosmetics, makeup, jewellery',
      it: 'vestiti, abbigliamento, scarpe, maglietta, pantaloni, giacca, regalo, regali, libro, libri, libreria, elettronica, profumeria, profumo, cosmetici, trucco, gioielli',
      es: 'ropa, zapatos, camiseta, pantalones, chaqueta, regalo, regalos, libro, libros, librería, electrónica, perfumería, perfume, cosméticos, maquillaje, joyas',
      fr: 'vêtements, chaussures, tshirt, pantalon, veste, cadeau, cadeaux, livre, livres, librairie, électronique, parfumerie, parfum, cosmétiques, maquillage, bijoux',
      de: 'kleidung, schuhe, hemd, hose, jacke, geschenk, geschenke, buch, bücher, buchhandlung, elektronik, parfüm, kosmetik, schminke, schmuck',
    },
  },
  {
    icon: '🎬',
    color: '#eda100',
    names: { en: 'Leisure', it: 'Svago', es: 'Ocio', fr: 'Loisirs', de: 'Freizeit' },
    shared:
      'netflix, spotify, disney, prime video, amazon prime, dazn, sky, apple music, apple tv, youtube, twitch, ' +
      'playstation, psn, xbox, nintendo, steam, ticketone, ticketmaster, eventbrite, karaoke, escape room, bowling, zoo, hobby, padel',
    words: {
      en: 'cinema, movie, movies, theatre, concert, museum, exhibition, videogame, game, games, nightclub, party, stadium, match, football',
      it: 'cinema, film, teatro, concerto, museo, mostra, videogioco, gioco, giochi, discoteca, festa, stadio, partita, calcio',
      es: 'cine, película, teatro, concierto, museo, exposición, videojuego, juego, juegos, discoteca, fiesta, estadio, partido, fútbol',
      fr: 'cinéma, film, théâtre, concert, musée, exposition, jeu vidéo, jeu, jeux, boîte de nuit, fête, stade, match, football',
      de: 'kino, film, theater, konzert, museum, ausstellung, videospiel, spiel, spiele, disco, party, stadion, fußball',
    },
  },
  {
    icon: '✈️',
    color: '#008300',
    names: { en: 'Travel', it: 'Viaggi', es: 'Viajes', fr: 'Voyages', de: 'Reisen' },
    shared:
      'hotel, hostel, airbnb, bnb, booking, expedia, trivago, ryanair, easyjet, vueling, wizz, wizzair, lufthansa, ' +
      'ita airways, alitalia, iberia, air france, klm, british airways, eurowings, transavia, volotea, resort, camping, souvenir',
    words: {
      en: 'flight, flights, plane, airport, holiday, holidays, vacation, trip, cruise, ferry, guesthouse, bed and breakfast',
      it: 'volo, voli, aereo, aeroporto, vacanza, vacanze, viaggio, crociera, traghetto, albergo, ostello, pensione, campeggio',
      es: 'vuelo, vuelos, avión, aeropuerto, vacaciones, viaje, crucero, ferri, hostal, pensión, cámping',
      fr: 'vol, vols, avion, aéroport, vacances, voyage, croisière, ferry, auberge, pension, camping',
      de: 'flug, flüge, flugzeug, flughafen, urlaub, reise, kreuzfahrt, fähre, pension, herberge, zelten',
    },
  },
  {
    icon: '📦',
    color: '#898781',
    names: { en: 'Other', it: 'Altro', es: 'Otros', fr: 'Autres', de: 'Sonstiges' },
    shared: '',
    words: { en: '', it: '', es: '', fr: '', de: '' },
  },
];

const LANG_CODES = Object.keys(LANGS) as Lang[];

const list = (s: string): string[] => s.split(',').map((k) => k.trim()).filter(Boolean);

/** Drops repeats, comparing accent- and case-insensitively. */
const unique = (keywords: string[]): string[] => {
  const seen = new Set<string>();
  return keywords.filter((k) => {
    const key = normalize(k);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** The everyday words of one language, then the proper nouns: what a fresh install gets. */
const seedKeywords = (seed: Seed, lang: Lang): string[] => unique([...list(seed.words[lang]), ...list(seed.shared)]);

const seedByName = (name: string): Seed | undefined => {
  const wanted = name.trim().toLowerCase();
  return SEEDS.find((s) => Object.values(s.names).some((v) => v.toLowerCase() === wanted));
};

/** Most of one language's default words are there: this is a standard category the user renamed. */
const holdsSeedWords = (seed: Seed, keywords: string[]): boolean => {
  const words = new Set(keywords.map(normalize));
  return LANG_CODES.some((l) => {
    const own = list(seed.words[l]).map(normalize);
    return own.length >= 5 && own.filter((w) => words.has(w)).length >= own.length * 0.7;
  });
};

const seedFor = (name: string, keywords?: string[]): Seed | undefined =>
  seedByName(name) ?? (keywords?.length ? SEEDS.find((s) => holdsSeedWords(s, keywords)) : undefined);

/** The same standard category in another language, or null when it isn't a standard one. */
export function seedNameFor(name: string, lang: Lang): string | null {
  return seedFor(name)?.names[lang] ?? null;
}

/**
 * The keywords of a standard category restated in `lang`: the defaults for that language plus
 * whatever the user added themselves. Words belonging to the other languages are dropped.
 */
export function keywordsInLanguage(name: string, lang: Lang, keywords: string[]): string[] | null {
  const seed = seedFor(name, keywords);
  if (!seed) return null;
  const known = new Set(LANG_CODES.flatMap((l) => list(seed.words[l])).map(normalize));
  return unique([...seedKeywords(seed, lang), ...keywords.filter((k) => !known.has(normalize(k)))]);
}

/** True when a standard category still carries words from another language. Order doesn't count. */
export function hasForeignKeywords(category: Category, lang: Lang): boolean {
  const next = keywordsInLanguage(category.name, lang, category.keywords);
  if (!next) return false;
  const have = new Set(category.keywords.map(normalize));
  return next.length !== have.size || next.some((k) => !have.has(normalize(k)));
}

export function defaultCategories(lang: Lang): Category[] {
  return SEEDS.map((s) => ({ name: s.names[lang], icon: s.icon, color: s.color, keywords: seedKeywords(s, lang) }));
}

export const EMOJIS = ['🛒', '🍽️', '☕', '🍕', '🚗', '⛽', '🚆', '🏠', '💡', '📱', '💊', '🏋️', '🛍️', '👕', '🎁', '🎬', '🎮', '🎵', '✈️', '🏖️', '🐶', '👶', '🎓', '💼', '💸', '🧾', '🔧', '📦'];
