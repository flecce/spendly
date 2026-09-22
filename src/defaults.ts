import type { Lang } from './i18n';
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
  keywords: string;
}

// Keywords are multilingual (IT, EN, ES, FR, DE) and matched accent-insensitively.
const SEEDS: Seed[] = [
  {
    icon: '🛒',
    color: '#1baf7a',
    names: { en: 'Groceries', it: 'Spesa', es: 'Supermercado', fr: 'Courses', de: 'Lebensmittel' },
    keywords:
      'spesa, supermercato, alimentari, supermarket, groceries, grocery, supermercado, compra, supermarche, courses, epicerie, supermarkt, lebensmittel, ' +
      'mercato, market, mercado, marche, panetteria, panificio, forno, bakery, panaderia, boulangerie, backerei, baeckerei, macelleria, butcher, carniceria, boucherie, metzgerei, ' +
      'fruttivendolo, frutta, verdura, esselunga, coop, conad, lidl, aldi, carrefour, eurospin, despar, penny, pam, iper, bennet, famila, tigre, crai, mercadona, dia, eroski, ' +
      'alcampo, auchan, leclerc, intermarche, monoprix, franprix, rewe, edeka, netto, kaufland, tesco, sainsbury, asda, waitrose, walmart, costco, whole foods',
  },
  {
    icon: '🍽️',
    color: '#eb6834',
    names: { en: 'Eating out', it: 'Ristoranti e bar', es: 'Restaurantes', fr: 'Restaurants', de: 'Essen gehen' },
    keywords:
      'ristorante, trattoria, osteria, pizzeria, pizza, restaurant, restaurante, sushi, ramen, kebab, burger, hamburger, mcdonald, mcdonalds, burger king, kfc, starbucks, ' +
      'bar, pub, caffe, cafe, coffee, kaffee, cappuccino, espresso, cornetto, brioche, colazione, breakfast, desayuno, petit dejeuner, fruhstuck, ' +
      'pranzo, lunch, almuerzo, dejeuner, mittagessen, cena, dinner, diner, abendessen, aperitivo, aperitif, apero, spritz, birra, beer, cerveza, biere, bier, ' +
      'gelato, gelateria, ice cream, helado, glace, deliveroo, glovo, just eat, justeat, uber eats, ubereats, lieferando, tapas, brunch, takeaway, asporto, bistro, brasserie, panino, sandwich, bocadillo, imbiss',
  },
  {
    icon: '🚗',
    color: '#2a78d6',
    names: { en: 'Transport', it: 'Trasporti', es: 'Transporte', fr: 'Transports', de: 'Verkehr' },
    keywords:
      'benzina, carburante, gasolio, rifornimento, diesel, fuel, petrol, gasolina, carburant, essence, gazole, benzin, tanken, tankstelle, esso, shell, repsol, q8, ' +
      'treno, train, tren, zug, trenitalia, italo, renfe, sncf, ouigo, bahn, deutsche bahn, flixbus, bus, autobus, pullman, metro, metropolitana, tram, subway, underground, ' +
      'taxi, uber, bolt, free now, freenow, cabify, lyft, parcheggio, parking, parken, parkhaus, aparcamiento, estacionamiento, autostrada, pedaggio, telepass, toll, peaje, peage, maut, vignette, ' +
      'noleggio, rental, carsharing, car sharing, share now, monopattino, scooter, officina, meccanico, mechanic, taller, garage, werkstatt, tagliando, revisione, gomme, pneumatici, tyres, tires, lavaggio, car wash',
  },
  {
    icon: '🏠',
    color: '#4a3aa7',
    names: { en: 'Home & bills', it: 'Casa e bollette', es: 'Casa y facturas', fr: 'Logement & factures', de: 'Wohnen & Rechnungen' },
    keywords:
      'affitto, rent, alquiler, loyer, miete, mutuo, mortgage, hipoteca, hypotheque, hypothek, condominio, bolletta, bollette, bill, bills, factura, facture, ' +
      'luce, elettricita, electricity, electricidad, electricite, strom, gas, internet, wifi, fibra, fiber, telefono, phone, cellulare, ricarica, handy, ' +
      'tim, vodafone, windtre, iliad, fastweb, movistar, orange, sfr, bouygues, telekom, o2, enel, hera, a2a, iren, edison, endesa, iberdrola, edf, engie, ' +
      'tari, imu, tasse, taxes, impuestos, impots, steuer, steuern, assicurazione, insurance, seguro, assurance, versicherung, ' +
      'ikea, leroy merlin, bricolage, obi, bauhaus, brico, arredamento, mobili, furniture, pulizie, cleaning, riscaldamento, heating, calefaccion, chauffage, heizung, idraulico, plumber, elettricista, electrician, lavanderia, laundry',
  },
  {
    icon: '💊',
    color: '#e34948',
    names: { en: 'Health & care', it: 'Salute e benessere', es: 'Salud y bienestar', fr: 'Santé & bien-être', de: 'Gesundheit & Pflege' },
    keywords:
      'farmacia, pharmacy, pharmacie, apotheke, medico, dottore, doctor, medecin, arzt, dentista, dentist, dentiste, zahnarzt, ospedale, hospital, hopital, krankenhaus, ' +
      'clinica, clinic, clinique, klinik, visita, analisi, esami, medicine, medicina, medicinali, farmaco, farmaci, medicament, medikament, ' +
      'ottico, optician, occhiali, glasses, gafas, lunettes, brille, lenti, fisioterapia, fisioterapista, physio, physiotherapy, psicologo, psychologist, terapia, therapy, ' +
      'veterinario, vet, veterinaire, tierarzt, palestra, gym, gimnasio, fitness, yoga, parrucchiere, barbiere, hairdresser, barber, peluqueria, coiffeur, friseur, estetista, massaggio, massage, spa',
  },
  {
    icon: '🛍️',
    color: '#e87ba4',
    names: { en: 'Shopping', it: 'Shopping', es: 'Compras', fr: 'Shopping', de: 'Shopping' },
    keywords:
      'amazon, ebay, zalando, zara, primark, uniqlo, mango, decathlon, mediaworld, unieuro, euronics, fnac, el corte ingles, mediamarkt, media markt, saturn, apple store, aliexpress, shein, temu, ' +
      'vestiti, abbigliamento, clothes, clothing, ropa, vetements, kleidung, scarpe, shoes, zapatos, chaussures, schuhe, maglietta, pantaloni, jeans, giacca, jacket, ' +
      'regalo, regali, gift, cadeau, geschenk, libro, libri, book, books, livre, buch, libreria, bookstore, feltrinelli, mondadori, elettronica, electronics, ' +
      'profumeria, profumo, perfume, parfum, sephora, douglas, cosmetici, cosmetics, makeup, trucco, gioielli, jewelry',
  },
  {
    icon: '🎬',
    color: '#eda100',
    names: { en: 'Leisure', it: 'Svago', es: 'Ocio', fr: 'Loisirs', de: 'Freizeit' },
    keywords:
      'cinema, cine, kino, movie, movies, film, teatro, theatre, theater, concerto, concert, konzert, concierto, museo, museum, musee, mostra, exhibition, exposition, ausstellung, ' +
      'netflix, spotify, disney, prime video, amazon prime, dazn, sky, apple music, apple tv, youtube, twitch, playstation, psn, xbox, nintendo, steam, ' +
      'videogioco, videogame, game, games, gioco, giochi, juego, jeu, spiel, bowling, discoteca, disco, club, festa, party, fiesta, fete, stadio, stadium, partita, calcio, football, soccer, ' +
      'ticketone, ticketmaster, eventbrite, karaoke, escape room, zoo, hobby',
  },
  {
    icon: '✈️',
    color: '#008300',
    names: { en: 'Travel', it: 'Viaggi', es: 'Viajes', fr: 'Voyages', de: 'Reisen' },
    keywords:
      'hotel, albergo, hostel, ostello, hostal, auberge, airbnb, bnb, booking, expedia, volo, voli, flight, flights, vuelo, vol, flug, aereo, airplane, avion, flugzeug, ' +
      'ryanair, easyjet, vueling, wizz, wizzair, lufthansa, ita airways, alitalia, iberia, air france, klm, british airways, eurowings, transavia, volotea, ' +
      'aeroporto, airport, aeropuerto, aeroport, flughafen, vacanza, vacanze, holiday, holidays, vacation, vacaciones, vacances, urlaub, viaggio, trip, viaje, voyage, reise, ' +
      'crociera, cruise, crucero, croisiere, kreuzfahrt, traghetto, ferry, resort, campeggio, camping, souvenir',
  },
  {
    icon: '📦',
    color: '#898781',
    names: { en: 'Other', it: 'Altro', es: 'Otros', fr: 'Autres', de: 'Sonstiges' },
    keywords: '',
  },
];

/** The same standard category in another language, or null when it isn't a standard one. */
export function seedNameFor(name: string, lang: Lang): string | null {
  const wanted = name.trim().toLowerCase();
  const seed = SEEDS.find((s) => Object.values(s.names).some((v) => v.toLowerCase() === wanted));
  return seed ? seed.names[lang] : null;
}

export function defaultCategories(lang: Lang): Category[] {
  return SEEDS.map((s) => ({
    name: s.names[lang],
    icon: s.icon,
    color: s.color,
    keywords: s.keywords.split(',').map((k) => k.trim()).filter(Boolean),
  }));
}

export const EMOJIS = ['🛒', '🍽️', '☕', '🍕', '🚗', '⛽', '🚆', '🏠', '💡', '📱', '💊', '🏋️', '🛍️', '👕', '🎁', '🎬', '🎮', '🎵', '✈️', '🏖️', '🐶', '👶', '🎓', '💼', '💸', '🧾', '🔧', '📦'];
