import { z } from "zod";
import type { ZoneSheetRule } from "../domain/types.js";
import { hasDatabaseConnection } from "./pgPool.js";
import { logger } from "../logging/logger.js";
import { loadZoneMappingFromSheet } from "../sheets/loadZoneMappingFromSheet.js";

const HARD_CODED_ZONE_SHEET_MAPPING: Array<[string, string]> = [
  ["BARBARICINA", "AG-PISA"], // FERIE LUIGI: era "LUIGI"
  ["BORGHETTO", "EROS"],
  ["CALAMBRONE", "AG-PISA"],
  ["CEP", "AG-PISA"], // FERIE LUIGI: era "LUIGI"
  ["CISANELLO", "STEFANIA"], // FERIE STEFANIA: era "STEFANIA"
  ["COLTANO", "REBECCA"], // FERIE REBECCA: era "REBECCA"
  ["DON BOSCO", "AG-PISA"], // FERIE VALENTINA: era "VALENTINA"
  ["GAGNO", "AG-PISA"],
  ["I PASSI", "AG-PISA"],
  ["LA VETTOLA", "AG-PISA"], // FERIE LUIGI: era "LUIGI"
  ["MARINA DI PISA", "AG-PISA"],
  ["MONTACCHIELLO", "REBECCA"], // FERIE REBECCA: era "REBECCA"
  ["ORATOIO", "AG-PISA"],
  ["OSPEDALETTO", "REBECCA"], // FERIE REBECCA: era "REBECCA"
  ["PIAGGE", "STEFANIA"], // FERIE STEFANIA: era "STEFANIA"
  ["PISANOVA", "AG-PISA"], // FERIE VALENTINA: era "VALENTINA"
  ["PORTA A LUCCA", "AG-PISA"], // FERIE GIUSEPPE: era "GIUSEPPE"
  ["PORTA A MARE", "AG-PISA"], // FERIE MARCO: era "MARCO"
  ["PORTA FIORENTINA", "MASSIMO"],
  ["BORGATA SESTRIERE", "MASSIMO"],
  ["PORTA NUOVA", "MATTIA"],
  ["PRATALE", "AG-PISA"], // FERIE GIUSEPPE: era "GIUSEPPE"
  ["PUTIGNANO", "AG-PISA"],
  ["RIGLIONE", "AG-PISA"],
  ["SAN FRANCESCO", "EROS"],
  ["SAN GIUSTO", "AG-PISA"], // FERIE MARTA: era "MARTA"
  ["SAN MARCO", "AG-PISA"], // FERIE MARTA: era "MARTA"
  ["SAN MARTINO", "SAMUELE"],
  ["SAN PIERO A GRADO", "AG-PISA"], // FERIE LUIGI: era "LUIGI"
  ["SAN ROSSORE", "AG-PISA"], // FERIE LUIGI: era "LUIGI"
  ["SANTA MARIA", "MATTIA"],
  ["SANT'ANTONIO", "AG-PISA"], // FERIE MARCO: era "MARCO"
  ["SANT'ERMETE", "MASSIMO"],
  ["STAZIONE", "SAMUELE"],
  ["TIRRENIA", "AG-PISA"],
  ["Bientina", "AG-PONTEDERA"],
  ["Buti", "AG-PONTEDERA"],
  ["Calci", "AG-PISA"], // FERIE GIUSEPPE: era "GIUSEPPE"
  ["Calci Alta", "AG-PISA"], // FERIE GIUSEPPE: era "GIUSEPPE"
  ["Calci La Corte", "AG-PISA"], // FERIE GIUSEPPE: era "GIUSEPPE"
  ["Capoluogo", "AG-PISA"], // FERIE GIUSEPPE: era "GIUSEPPE"
  ["Castel Maggiore", "AG-PISA"], // FERIE GIUSEPPE: era "GIUSEPPE"
  ["Il Colle", "AG-PISA"], // FERIE GIUSEPPE: era "GIUSEPPE"
  ["La Corte", "AG-PISA"], // FERIE GIUSEPPE: era "GIUSEPPE"
  ["La Gabella", "AG-PISA"], // FERIE GIUSEPPE: era "GIUSEPPE"
  ["La Pieve", "AG-PISA"], // FERIE GIUSEPPE: era "GIUSEPPE"
  ["MonteMagno", "AG-PISA"], // FERIE GIUSEPPE: era "GIUSEPPE"
  ["Paduletto", "AG-PISA"], // FERIE GIUSEPPE: era "GIUSEPPE"
  ["Rezzano", "AG-PISA"], // FERIE GIUSEPPE: era "GIUSEPPE"
  ["San Lorenzo", "AG-PISA"], // FERIE GIUSEPPE: era "GIUSEPPE"
  ["Santa Lucia", "AG-PISA"], // FERIE GIUSEPPE: era "GIUSEPPE"
  ["Tre Colli", "AG-PISA"], // FERIE GIUSEPPE: era "GIUSEPPE"
  ["Villa Sant'Andrea", "AG-PISA"], // FERIE GIUSEPPE: era "GIUSEPPE"
  ["Calcinaia", "REBECCA"], // FERIE REBECCA: era "REBECCA"
  ["Fornacette", "AG-PONTEDERA"],
  ["Montecchio", "AG-PONTEDERA"],
  ["Oltrarno", "AG-PONTEDERA"],
  ["Pardossi", "AG-PONTEDERA"],
  ["Capannoli", "AG-PONTEDERA"],
  ["San Pietro Belvedere", "AG-PISA"],
  ["Santo Pietro Belvedere", "AG-PISA"],
  ["Solaia", "AG-PISA"],
  ["Casale Marittimo", "AG-PISA"],
  ["Casciana Terme Lari", "AG-PONTEDERA"], // FERIE FAUSTO: era "FAUSTO",
  ["Boschi di Lari", "AG-PONTEDERA"], // FERIE FAUSTO: era "FAUSTO",
  ["Casciana Alta", "AG-PONTEDERA"], // FERIE FAUSTO: era "FAUSTO",
  ["Casciana Terme", "AG-PONTEDERA"], // FERIE FAUSTO: era "FAUSTO",
  ["Cevoli", "AG-PONTEDERA"], // FERIE FAUSTO: era "FAUSTO",
  ["Colle Montanino", "AG-PONTEDERA"], // FERIE FAUSTO: era "FAUSTO",
  ["La Capannina", "AG-PONTEDERA"], // FERIE FAUSTO: era "FAUSTO",
  ["Lari", "AG-PONTEDERA"], // FERIE FAUSTO: era "FAUSTO",
  ["Lavaiano", "AG-PONTEDERA"], // FERIE FAUSTO: era "FAUSTO",
  ["Parlascio", "AG-PONTEDERA"], // FERIE FAUSTO: era "FAUSTO",
  ["Perignano", "AG-PONTEDERA"], // FERIE FAUSTO: era "FAUSTO",
  ["Quattro strade", "AG-PONTEDERA"], // FERIE FAUSTO: era "FAUSTO",
  ["San Ruffino", "AG-PONTEDERA"], // FERIE FAUSTO: era "FAUSTO",
  ["Sant'Ermo", "AG-PONTEDERA"], // FERIE FAUSTO: era "FAUSTO",
  ["Usigliano", "AG-PONTEDERA"], // FERIE FAUSTO: era "FAUSTO",
  ["Cascina", "TOMMASO"],
  ["Badia", "TOMMASO"],
  ["Capoluogo", "TOMMASO"],
  ["Casciavola", "TOMMASO"],
  ["Cascina Stadio Vecchio", "TOMMASO"],
  ["Ipercoop", "TOMMASO"],
  ["Laiano", "TOMMASO"],
  ["Latignano", "TOMMASO"],
  ["Marciana", "TOMMASO"],
  ["Montione", "TOMMASO"],
  ["Musigliano", "TOMMASO"],
  ["Navacchio", "TOMMASO"],
  ["Pettori", "TOMMASO"],
  ["Ripoli", "TOMMASO"],
  ["San Lorenzo alle Corti", "TOMMASO"],
  ["San Benedetto", "TOMMASO"],
  ["San Casciano", "TOMMASO"],
  ["San Frediano", "TOMMASO"],
  ["San Frediano A Settimo", "TOMMASO"],
  ["San Giorgio", "TOMMASO"],
  ["San Lorenzo a Pagnatico", "TOMMASO"],
  ["San Prospero", "TOMMASO"],
  ["San Sisto", "TOMMASO"],
  ["Sant'Anna", "TOMMASO"],
  ["Santo Stefano a Macerata", "TOMMASO"],
  ["Sant'anna Di Cascina", "TOMMASO"],
  ["Titignano", "TOMMASO"],
  ["Visignano", "TOMMASO"],
  ["Zambra", "TOMMASO"],
  ["Zona Artigianale", "TOMMASO"],
  ["Castelfranco di Sotto", "AG-PISA"],
  ["Castellina Marittima", "AG-PISA"],
  ["Castelnuovo di Val di Cecina", "AG-PISA"],
  ["Chianni", "AG-PISA"],
  ["Crespina Lorenzana", "AG-PONTEDERA"], // FERIE FAUSTO: era "FAUSTO",
  ["Belvedere", "AG-PONTEDERA"], // FERIE FAUSTO: era "FAUSTO",
  ["Botteghino", "AG-PONTEDERA"], // FERIE FAUSTO: era "FAUSTO",
  ["Cenaia", "AG-PONTEDERA"], // FERIE FAUSTO: era "FAUSTO",
  ["Cenaia Vecchia", "AG-PONTEDERA"], // FERIE FAUSTO: era "FAUSTO",
  ["Ceppaiano", "AG-PONTEDERA"], // FERIE FAUSTO: era "FAUSTO",
  ["Colle Alberti", "AG-PONTEDERA"], // FERIE FAUSTO: era "FAUSTO",
  ["Crespina", "AG-PONTEDERA"], // FERIE FAUSTO: era "FAUSTO",
  ["Fungiaia", "AG-PONTEDERA"], // FERIE FAUSTO: era "FAUSTO",
  ["I Gioielli", "AG-PONTEDERA"], // FERIE FAUSTO: era "FAUSTO",
  ["II Colle", "AG-PONTEDERA"], // FERIE FAUSTO: era "FAUSTO",
  ["La Casa", "AG-PONTEDERA"], // FERIE FAUSTO: era "FAUSTO",
  ["La Tana", "AG-PONTEDERA"], // FERIE FAUSTO: era "FAUSTO",
  ["Laura", "AG-PONTEDERA"], // FERIE FAUSTO: era "FAUSTO",
  ["Lavoria", "AG-PONTEDERA"], // FERIE FAUSTO: era "FAUSTO",
  ["Le Lame", "AG-PONTEDERA"], // FERIE FAUSTO: era "FAUSTO",
  ["Lorenzana", "AG-PONTEDERA"], // FERIE FAUSTO: era "FAUSTO",
  ["Migliano", "AG-PONTEDERA"], // FERIE FAUSTO: era "FAUSTO",
  ["Siberia", "AG-PONTEDERA"], // FERIE FAUSTO: era "FAUSTO",
  ["Tremoleto", "AG-PONTEDERA"], // FERIE FAUSTO: era "FAUSTO",
  ["Tripalle", "AG-PONTEDERA"], // FERIE FAUSTO: era "FAUSTO",
  ["Vicchio", "AG-PONTEDERA"], // FERIE FAUSTO: era "FAUSTO",
  ["Volpaia", "AG-PONTEDERA"], // FERIE FAUSTO: era "FAUSTO",
  ["Fauglia", "AG-LIVORNO"],
  ["Parrana San Martino", "AG-LIVORNO"],
  ["Guardistallo", "AG-PISA"],
  ["Lajatico", "AG-PONTEDERA"],
  ["Lorenzana", "AG-PISA"],
  ["Montecatini Val di Cecina", "AG-PISA"],
  ["Montescudaio", "AG-PISA"],
  ["Monteverdi Marittimo", "AG-PISA"],
  ["Montopoli in Val d'Arno", "AG-PISA"],
  ["Orciano Pisano", "AG-PISA"],
  ["Palaia", "AG-PONTEDERA"],
  ["Peccioli", "AG-PONTEDERA"],
  ["BELLARIA", "AG-PONTEDERA"],
  ["BRACCIONI PIETROCONTI", "AG-PONTEDERA"],
  ["BRACCIONI", "AG-PONTEDERA"],
  ["PIETROCONTI", "AG-PONTEDERA"],
  ["CENTRO", "ELISABETTA"], // FERIE ELISABETTA: era "ELISABETTA"
  ["CHIESINO", "AG-PONTEDERA"],
  ["GELLO", "AG-PONTEDERA"],
  ["I FABBRI", "AG-PONTEDERA"],
  ["IL ROMITO", "AG-PONTEDERA"],
  ["LA BIANCA", "AG-PONTEDERA"],
  ["LA BORRA", "AG-PONTEDERA"],
  ["LA ROTTA", "AG-PONTEDERA"],
  ["MONTECASTELLO", "AG-PONTEDERA"],
  ["OLTRERA", "AG-PONTEDERA"],
  ["OSPEDALE", "ELISABETTA"], // FERIE ELISABETTA: era "ELISABETTA"
  ["PARDOSSI", "AG-PONTEDERA"],
  ["SANTA LUCIA", "AG-PONTEDERA"],
  ["STADIO", "ELISABETTA"], // FERIE ELISABETTA: era "ELISABETTA"
  ["STAZIONE", "ELISABETTA"], // FERIE ELISABETTA: era "ELISABETTA"
  ["TREGGIAIA", "AG-PONTEDERA"],
  ["VILLAGGIO GRAMSCI", "AG-PONTEDERA"],
  ["Caccialupi", "AG-PONTEDERA"],
  ["Località Guerrazzi", "AG-PONTEDERA"],
  ["Puntone", "AG-PONTEDERA"],
  ["Quattro Strade", "AG-PONTEDERA"],
  ["Quatro strade", "AG-PONTEDERA"],
  ["Quattrostrade", "AG-PONTEDERA"],
  ["S.colomba", "AG-PONTEDERA"],
  ["Santa Colomba", "AG-PONTEDERA"],
  ["Zona Coop", "AG-PONTEDERA"],
  ["Cascine", "AG-PONTEDERA"],
  ["Cascine Di Buti", "AG-PONTEDERA"],
  ["Castel Di Nocco", "AG-PONTEDERA"],
  ["La Croce", "AG-PONTEDERA"],
  ["Panicale sopra Buti", "AG-PONTEDERA"],
  ["capoluogo", "AG-PONTEDERA"],
  ["Galleno", "AG-PONTEDERA"],
  ["Orentano", "AG-PONTEDERA"],
  ["Villa Campanile", "AG-PONTEDERA"],
  ["Le Badie", "AG-PONTEDERA"],
  ["Malandrone", "AG-PONTEDERA"],
  ["Montecastelli Pisano", "AG-PONTEDERA"],
  ["Sasso Pisano", "AG-PONTEDERA"],
  ["Zona", "AG-PONTEDERA"],
  ["Garetto", "AG-PONTEDERA"],
  ["I Guelfi", "AG-PONTEDERA"],
  ["La Fornace", "AG-PONTEDERA"],
  ["La Pescaia", "AG-PONTEDERA"],
  ["La Pieve", "AG-PONTEDERA"],
  ["Rivalto", "AG-PONTEDERA"],
  ["Sassi Bianchi", "AG-PONTEDERA"],
  ["Acciaiolo", "AG-PONTEDERA"],
  ["Luciana", "AG-PONTEDERA"],
  ["Valtriano", "AG-PONTEDERA"],
  ["Casina Di Terra", "AG-PONTEDERA"],
  ["Orciatico", "AG-PONTEDERA"],
  ["Villaggio San Giovanni", "AG-PONTEDERA"],
  ["Buriano", "AG-PONTEDERA"],
  ["Casaglia", "AG-PONTEDERA"],
  ["Castello di Querceto", "AG-PONTEDERA"],
  ["Gello", "AG-PONTEDERA"],
  ["Miemo", "AG-PONTEDERA"],
  ["Ponteginori", "AG-PONTEDERA"],
  ["Sassa", "AG-PONTEDERA"],
  ["Casagiustri", "AG-PONTEDERA"],
  ["Fiorino", "AG-PONTEDERA"],
  ["Canneto", "AG-PONTEDERA"],
  ["Scotriano", "AG-PONTEDERA"],
  ["Capanne", "AG-PONTEDERA"],
  ["Casteldelbosco", "AG-PONTEDERA"],
  ["Marti", "AG-PONTEDERA"],
  ["San Romano", "AG-PONTEDERA"],
  ["Alica", "AG-PONTEDERA"],
  ["Baccanella", "AG-PONTEDERA"],
  ["Chiecinella", "AG-PONTEDERA"],
  ["Colleoli", "AG-PONTEDERA"],
  ["Forcoli", "AG-PONTEDERA"],
  ["Forcoli San Iacopo", "AG-PONTEDERA"],
  ["Gello", "AG-PONTEDERA"],
  ["Montacchita", "AG-PONTEDERA"],
  ["Montanelli", "AG-PONTEDERA"],
  ["Montechiari", "AG-PONTEDERA"],
  ["Montefoscoli", "AG-PONTEDERA"],
  ["Partino", "AG-PONTEDERA"],
  ["San Gervasio", "AG-PONTEDERA"],
  ["Sant'Andrea", "AG-PONTEDERA"],
  ["Toiano", "AG-PONTEDERA"],
  ["Usigliano", "AG-PONTEDERA"],
  ["Villa Saletta", "AG-PONTEDERA"],
  ["Cedri", "AG-PONTEDERA"],
  ["Fabbrica", "AG-PONTEDERA"],
  ["Ghizzano", "AG-PONTEDERA"],
  ["Legoli", "AG-PONTEDERA"],
  ["Libbiano", "AG-PONTEDERA"],
  ["Montecchio", "AG-PONTEDERA"],
  ["Larderello", "AG-PONTEDERA"],
  ["Libbiano", "AG-PONTEDERA"],
  ["Lustignano", "AG-PONTEDERA"],
  ["Micciano", "AG-PONTEDERA"],
  ["Montecerboli", "AG-PONTEDERA"],
  ["Montegemoli", "AG-PONTEDERA"],
  ["San Dalmazio", "AG-PONTEDERA"],
  ["Serrazzano", "AG-PONTEDERA"],
  ["Camugliano", "AG-PONTEDERA"],
  ["Centro Storico", "AG-PONTEDERA"],
  ["I Poggini", "AG-PONTEDERA"],
  ["Le Melorie", "AG-PONTEDERA"],
  ["Parco Urbano", "AG-PONTEDERA"],
  ["Ponsacco", "AG-PONTEDERA"],
  ["Val Di Cava", "AG-PONTEDERA"],
  ["Zona Coop", "AG-PONTEDERA"],
  ["Nocolino", "AG-PONTEDERA"],
  ["Bucciano Balconevisi", "AG-PONTEDERA"],
  ["Catena", "AG-PONTEDERA"],
  ["Cigoli", "AG-PONTEDERA"],
  ["Corazzano", "AG-PONTEDERA"],
  ["Cusignano", "AG-PONTEDERA"],
  ["Montebicchieri", "AG-PONTEDERA"],
  ["Ponte a Egola", "AG-PONTEDERA"],
  ["Ponte a Elsa", "AG-PONTEDERA"],
  ["San Genesio", "AG-PONTEDERA"],
  ["San Miniato Basso", "AG-PONTEDERA"],
  ["Scala", "AG-PONTEDERA"],
  ["Staffoli", "AG-PONTEDERA"],
  ["Pieve Santa Luce", "AG-PONTEDERA"],
  ["Pastina", "AG-PONTEDERA"],
  ["Pomaia", "AG-PONTEDERA"],
  ["Calvana", "AG-PONTEDERA"],
  ["Cerretti", "AG-PONTEDERA"],
  ["Falorni", "AG-PONTEDERA"],
  ["Le Fontine", "AG-PONTEDERA"],
  ["Montecalvoli", "AG-PONTEDERA"],
  ["Montecalvoli in alto", "AG-PONTEDERA"],
  ["Montecalvoli in basso", "AG-PONTEDERA"],
  ["Ponticelli", "AG-PONTEDERA"],
  ["Pregiuntino", "AG-PONTEDERA"],
  ["San Donato", "AG-PONTEDERA"],
  ["Santa Maria A Monte", "AG-PONTEDERA"],
  ["Tavolaia", "AG-PONTEDERA"],
  ["La Chientina", "AG-PONTEDERA"],
  ["La Rosa", "AG-PONTEDERA"],
  ["La Sterza", "AG-PONTEDERA"],
  ["Morrona", "AG-PONTEDERA"],
  ["Selvatelle", "AG-PONTEDERA"],
  ["Soiana", "AG-PONTEDERA"],
  ["Soianella", "AG-PONTEDERA"],
  ["Terricciola", "AG-PONTEDERA"],
  ["Il Cipresso", "AG-PONTEDERA"],
  ["Mazzolla", "AG-PONTEDERA"],
  ["Montebradoni", "AG-PONTEDERA"],
  ["Montemiccioli", "AG-PONTEDERA"],
  ["Ponsano", "AG-PONTEDERA"],
  ["Prato d'Era", "AG-PONTEDERA"],
  ["Roncolla", "AG-PONTEDERA"],
  ["Saline", "AG-PONTEDERA"],
  ["San Cipriano", "AG-PONTEDERA"],
  ["Sensano", "AG-PONTEDERA"],
  ["Ulignano", "AG-PONTEDERA"],
  ["Vicarello", "AG-LIVORNO"],
  ["Villamagna", "AG-PONTEDERA"],
  ["CERRETO GUIDI - STABBIA", "AG-PONTEDERA"],
  ["Stabbia", "AG-PONTEDERA"],
  ["FUCECCHIO - SAN PIERINO", "AG-PONTEDERA"],
  ["FUCECCHIO", "AG-PONTEDERA"],
  ["EMPOLI - CENTRO", "AG-PONTEDERA"],
  ["FIRENZE - CAMPO DI MARTE", "AG-PONTEDERA"],
  ["FIRENZE - CENTRO OLTRARNO", "AG-PONTEDERA"],
  ["FUCECCHIO - PONTE A CAPPIANO", "AG-PONTEDERA"],
  ["FUCECCHIO - LA TORRE", "AG-PONTEDERA"],
  ["EMPOLI - PONTE A ELSA", "AG-PONTEDERA"],
  ["FUCECCHIO - BOTTEGHE", "AG-PONTEDERA"],
  ["Pomarance", "AG-PISA"],
  ["Ponsacco", "AG-PISA"],
  ["Pontedera", "ELISABETTA"], // FERIE ELISABETTA: era "ELISABETTA"
  ["Riparbella", "AG-PISA"],
  ["San Giuliano Terme", "DAVIDE"], // FERIE DAVIDE: era "DAVIDE"
  ["Agnano", "DAVIDE"], // FERIE DAVIDE: era "DAVIDE"
  ["Arena-Metato", "DAVIDE"], // FERIE DAVIDE: era "DAVIDE"
  ["Asciano", "DAVIDE"], // FERIE DAVIDE: era "DAVIDE"
  ["Asciano Pisano", "DAVIDE"], // FERIE DAVIDE: era "DAVIDE"
  ["Campo", "DAVIDE"], // FERIE DAVIDE: era "DAVIDE"
  ["Capoluogo", "DAVIDE"], // FERIE DAVIDE: era "DAVIDE"
  ["Cnr", "DAVIDE"], // FERIE DAVIDE: era "DAVIDE"
  ["Colignola", "DAVIDE"], // FERIE DAVIDE: era "DAVIDE"
  ["Colognole", "DAVIDE"], // FERIE DAVIDE: era "DAVIDE"
  ["Gello", "DAVIDE"], // FERIE DAVIDE: era "DAVIDE"
  ["Ghezzano", "DAVIDE"], // FERIE DAVIDE: era "DAVIDE"
  ["La Fontina", "DAVIDE"], // FERIE DAVIDE: era "DAVIDE"
  ["Madonna dell'Acqua", "DAVIDE"], // FERIE DAVIDE: era "DAVIDE"
  ["Mezzana", "DAVIDE"], // FERIE DAVIDE: era "DAVIDE"
  ["Molina di Quosa", "DAVIDE"], // FERIE DAVIDE: era "DAVIDE"
  ["no zona", "DAVIDE"], // FERIE DAVIDE: era "DAVIDE"
  ["Orzignano", "DAVIDE"], // FERIE DAVIDE: era "DAVIDE"
  ["Pappiana", "DAVIDE"], // FERIE DAVIDE: era "DAVIDE"
  ["Pontasserchio", "DAVIDE"], // FERIE DAVIDE: era "DAVIDE"
  ["Pugnano", "DAVIDE"], // FERIE DAVIDE: era "DAVIDE"
  ["Rigoli", "DAVIDE"], // FERIE DAVIDE: era "DAVIDE"
  ["Ripafratta", "DAVIDE"], // FERIE DAVIDE: era "DAVIDE"
  ["S. Andrea A Pescaiola", "DAVIDE"], // FERIE DAVIDE: era "DAVIDE"
  ["San Martino a Ulmiano", "DAVIDE"], // FERIE DAVIDE: era "DAVIDE"
  ["Sant'Andrea a Pescaiola", "DAVIDE"], // FERIE DAVIDE: era "DAVIDE"
  ["San Miniato", "AG-PISA"],
  ["San Vincenzo", "AG-LIVORNO"],
  ["Sassetta", "AG-LIVORNO"],
  ["Santa Croce sull'Arno", "AG-PISA"],
  ["Santa Luce", "AG-PISA"],
  ["Suvereto", "AG-LIVORNO"],
  ["Vecchiano", "DAVIDE"], // FERIE DAVIDE: era "DAVIDE"
  ["Avane", "DAVIDE"], // FERIE DAVIDE: era "DAVIDE"
  ["Filettole", "DAVIDE"], // FERIE DAVIDE: era "DAVIDE"
  ["Marina Di Vecchiano", "DAVIDE"], // FERIE DAVIDE: era "DAVIDE"
  ["Migliarino", "DAVIDE"], // FERIE DAVIDE: era "DAVIDE"
  ["Nodica", "DAVIDE"], // FERIE DAVIDE: era "DAVIDE"
  ["Vicopisano", "LUIS"], // FERIE LUIS: era "LUIS"
  ["Capoluogo", "LUIS"], // FERIE LUIS: era "LUIS"
  ["Caprona", "LUIS"], // FERIE LUIS: era "LUIS"
  ["Cevoli", "LUIS"], // FERIE LUIS: era "LUIS"
  ["Cucigliana", "LUIS"], // FERIE LUIS: era "LUIS"
  ["Guerrazzi", "LUIS"], // FERIE LUIS: era "LUIS"
  ["Loc. Lucchetta", "LUIS"], // FERIE LUIS: era "LUIS"
  ["Lugnano", "LUIS"], // FERIE LUIS: era "LUIS"
  ["Noce", "LUIS"], // FERIE LUIS: era "LUIS"
  ["Noce da togliere", "LUIS"], // FERIE LUIS: era "LUIS"
  ["Novi", "LUIS"], // FERIE LUIS: era "LUIS"
  ["S. Andrea", "LUIS"], // FERIE LUIS: era "LUIS"
  ["San Giovanni alla Vena", "LUIS"], // FERIE LUIS: era "LUIS"
  ["Uliveto Terme", "LUIS"], // FERIE LUIS: era "LUIS"
  ["Volterra", "AG-PISA"],
  ["Bibbona", "AG-LIVORNO"],
  ["Campiglia Marittima", "AG-LIVORNO"],
  ["Campo nell'Elba", "AG-LIVORNO"],
  ["Capoliveri", "AG-LIVORNO"],
  ["Capraia Isola", "AG-LIVORNO"],
  ["Castagneto Carducci", "AG-LIVORNO"],
  ["Cecina", "AG-LIVORNO"],
  ["Collesalvetti", "AG-LIVORNO"],
  ["Marciana", "AG-LIVORNO"],
  ["Marciana Marina", "AG-LIVORNO"],
  ["Piombino", "AG-LIVORNO"],
  ["Porto Azzurro", "AG-LIVORNO"],
  ["Portoferraio", "AG-LIVORNO"],
  ["Rio", "AG-LIVORNO"],
  ["Rio Marina", "AG-LIVORNO"],
  ["Rio nell'Elba", "AG-LIVORNO"],
  ["Rosignano Marittimo", "AG-LIVORNO"],
  ["Vada", "AG-LIVORNO"],
  ["ANTRACCOLI", "AG-LUCCA"],
  ["AQUILEA", "AG-LUCCA"],
  ["ARANCIO", "AG-LUCCA"],
  ["ARLIANO", "AG-LUCCA"],
  ["ARSINA", "ALFREDO"],
  ["BALBANO", "AG-LUCCA"],
  ["BORGO GIANNOTTI", "AG-LUCCA"],
  ["CARIGNANO", "AG-LUCCA"],
  ["CASTAGNORI", "AG-LUCCA"],
  ["CASTIGLIONCELLO", "AG-LUCCA"],
  ["CENTRO STORICO A", "AG-LUCCA"],
  ["CENTRO STORICO B", "AG-LUCCA"],
  ["CENTRO STORICO C", "AG-LUCCA"],
  ["CENTRO STORICO D", "AG-LUCCA"],
  ["CERASOMMA", "AG-LUCCA"],
  ["CHIATRI PUCCINI", "AG-LUCCA"],
  ["CICIANA", "AG-LUCCA"],
  ["COLLINE", "AG-LUCCA"],
  ["DECCIO DI BRANCOLI", "ALFREDO"],
  ["FAGNANO", "AG-LUCCA"],
  ["FARNETA", "AG-LUCCA"],
  ["FORMENTALE", "AG-LUCCA"],
  ["GATTAIOLA", "AG-LUCCA"],
  ["GIGNANO DI BRANCOLI", "AG-LUCCA"],
  ["GUGLIANO", "AG-LUCCA"],
  ["LA CAPPELLA", "AG-LUCCA"],
  ["LUCCA FUORI MURA", "AG-LUCCA"],
  ["MAGGIANO", "AG-LUCCA"],
  ["MAMMOLI", "AG-LUCCA"],
  ["MASSA PISANO", "AG-LUCCA"],
  ["MASTIANO", "AG-LUCCA"],
  ["MEATI", "AG-LUCCA"],
  ["MONTE SAN QUIRICO - VALLEBUIA", "AG-LUCCA"],
  ["MONTUOLO", "AG-LUCCA"],
  ["MUGNANO", "AG-LUCCA"],
  ["MUTIGLIANO", "AG-LUCCA"],
  ["NAVE", "AG-LUCCA"],
  ["NOZZANO CASTELLO", "AG-LUCCA"],
  ["NOZZANO SANPIERO", "AG-LUCCA"],
  ["OMBREGLIO DI BRANCOLI", "AG-LUCCA"],
  ["PALMATA", "AG-LUCCA"],
  ["PERIFERIA", "AG-LUCCA"],
  ["PIAGGIONE", "AG-LUCCA"],
  ["PIAZZA DI BRANCOLI", "AG-LUCCA"],
  ["PIAZZANO", "AG-LUCCA"],
  ["PICCIONARA", "AG-LUCCA"],
  ["PIEVE DI BRANCOLI", "AG-LUCCA"],
  ["PIEVE SANTO STEFANO", "AG-LUCCA"],
  ["PONTE A MORIANO", "AG-LUCCA"],
  ["PONTE SAN PIETRO", "AG-LUCCA"],
  ["PONTETETTO", "AG-LUCCA"],
  ["POZZUOLO", "AG-LUCCA"],
  ["SALTOCCHIO", "AG-LUCCA"],
  ["SAN CASSIANO A VICO", "AG-LUCCA"],
  ["SAN CASSIANO DI MORIANO", "AG-LUCCA"],
  ["SAN CONCORDIO CONTRADA", "AG-LUCCA"],
  ["SAN CONCORDIO DI MORIANO", "AG-LUCCA"],
  ["SAN DONATO", "AG-LUCCA"],
  ["SAN FILIPPO", "AG-LUCCA"],
  ["SAN GEMIGNANO DI MORIANO", "AG-LUCCA"],
  ["SAN GIUSTO DI BRANCOLI", "AG-LUCCA"],
  ["SAN LEONARDO IN TREPONZIO", "AG-LUCCA"],
  ["SAN LORENZO A VACCOLI", "AG-LUCCA"],
  ["SAN LORENZO DI BANCOLI", "AG-LUCCA"],
  ["SAN LORENZO DI MORIANO", "AG-LUCCA"],
  ["SAN MACARIO IN MONTE", "AG-LUCCA"],
  ["SAN MACARIO IN PIANO", "AG-LUCCA"],
  ["SAN MARCO", "AG-LUCCA"],
  ["SAN MARTINO IN VIGNALE", "AG-LUCCA"],
  ["SAN MICHELE DI MORIANO", "AG-LUCCA"],
  ["SAN MICHELE IN ESCHETTO", "AG-LUCCA"],
  ["SAN PANCRAZIO", "AG-LUCCA"],
  ["SAN PIETRO A VICO", "AG-LUCCA"],
  ["SAN QUIRICO DI MORIANO", "AG-LUCCA"],
  ["SAN VITO", "AG-LUCCA"],
  ["SANT'ALESSIO", "AG-LUCCA"],
  ["SANT'ANGELO IN CAMPO", "AG-LUCCA"],
  ["SANT'ANNA", "AG-LUCCA"],
  ["SANT'ILARIO DI BRANCOLI", "AG-LUCCA"],
  ["SANTA MARIA A COLLE", "AG-LUCCA"],
  ["SANTA MARIA DEL GIUDICE", "AG-LUCCA"],
  ["SANTO STEFANO DI MORIANO", "AG-LUCCA"],
  ["SESTO DI MORIANO", "AG-LUCCA"],
  ["SORBANO DEL GIUDICE", "AG-LUCCA"],
  ["SORBANO DEL VESCOVO", "AG-LUCCA"],
  ["SS. ANNUNZIATA", "AG-LUCCA"],
  ["STABBIANO", "AG-LUCCA"],
  ["TEMPAGNANO DI LUNATA", "AG-LUCCA"],
  ["TORRE", "AG-LUCCA"],
  ["TRAMONTE", "AG-LUCCA"],
  ["VECOLI", "AG-LUCCA"],
  ["VICINO MURA", "AG-LUCCA"],
  ["Pieve a Elici", "AG-LUCCA"],
  ["VICOPELAGO", "AG-LUCCA"],
  ["Altopascio", "AG-LUCCA"],
  ["Bagni di Lucca", "AG-LUCCA"],
  ["Barga", "ALFREDO"],
  ["Borgo a Mozzano", "AG-LUCCA"],
  ["Camaiore", "AG-LUCCA"],
  ["Lido di Camaiore", "AG-LUCCA"],
  ["Camaiore centro", "AG-LUCCA"],
  ["Camporgiano", "ALFREDO"],
  ["Capannori", "AG-LUCCA"],
  ["Careggine", "ALFREDO"],
  ["Castelnuovo di Garfagnana", "ALFREDO"],
  ["Castiglione di Garfagnana", "ALFREDO"],
  ["Coreglia Antelminelli", "ALFREDO"],
  ["Fabbriche di Vallico", "ALFREDO"],
  ["Fabbriche di Vergemoli", "ALFREDO"],
  ["Forte dei Marmi", "AG-LUCCA"],
  ["Fosciandora", "ALFREDO"],
  ["Gallicano", "ALFREDO"],
  ["Giuncugnano", "ALFREDO"],
  ["Lucca", "AG-LUCCA"],
  ["Massarosa", "AG-LUCCA"],
  ["Minucciano", "ALFREDO"],
  ["Molazzana", "ALFREDO"],
  ["Montecarlo", "AG-LUCCA"],
  ["Pescaglia", "AG-LUCCA"],
  ["Piazza al Serchio", "ALFREDO"],
  ["Pietrasanta", "AG-LUCCA"],
  ["Pieve Fosciana", "ALFREDO"],
  ["Porcari", "AG-LUCCA"],
  ["San Romano in Garfagnana", "ALFREDO"],
  ["Seravezza", "AG-LUCCA"],
  ["Sillano", "ALFREDO"],
  ["Sillano Giuncugnano", "ALFREDO"],
  ["Stazzema", "AG-LUCCA"],
  ["Vagli Sotto", "ALFREDO"],
  ["Vergemoli", "ALFREDO"],
  ["Viareggio", "AG-LUCCA"],
  ["Villa Basilica", "ALFREDO"],
  ["Villa Collemandina", "ALFREDO"],
  ["AULLA", "AG-LUCCA"],
  ["MASSA - MARINA DI MASSA", "AG-LUCCA"],
  ["Marina di Massa", "AG-LUCCA"],
  ["Ronchi", "AG-LUCCA"],
  ["MASSA", "AG-LUCCA"],
  ["MASSA - RONCHI", "AG-LUCCA"],
  ["MONTECATINI-TERME", "AG-LUCCA"],
  ["MONTECATINI-TERME - NIEVOLE", "AG-LUCCA"],
  ["MONTECATINI-TERME - BISCOLLA", "AG-LUCCA"],
  ["ABETONE CUTIGLIANO", "AG-LUCCA"],
  ["PESCIA - ALBERGHI", "AG-LUCCA"],
  ["PESCIA - ARAMO", "AG-LUCCA"],
  ["PESCIA", "AG-LUCCA"],
  ["Ghivizzano", "AG-LUCCA"],
  ["Capezzano", "AG-LUCCA"],
  ["Spaianate", "AG-LUCCA"],
  ["Capezzano Pianore", "AG-LUCCA"],
  ["Focette", "AG-LUCCA"],
  ["Lammari", "AG-LUCCA"],
  ["Popiglio", "AG-LUCCA"],
  ["Ponterosso", "AG-LUCCA"],
  ["Abetone", "AG-LUCCA"],
  ["CHIESINA UZZANESE - CHIESANUOVA", "AG-LUCCA"],
  ["SAN MARCELLO PITEGLIO", "AG-LUCCA"],
  ["BUGGIANO - BORGO A BUGGIANO", "AG-LUCCA"],
  ["CHIESINA UZZANESE - CAPANNA", "AG-LUCCA"],
  ["PISTOIA NORD", "AG-LUCCA"],
  ["UZZANO - LA COSTA", "AG-LUCCA"],
  ["BUGGIANO", "AG-LUCCA"],
  ["MONSUMMANO TERME - CINTOLESE", "AG-LUCCA"],
  ["UZZANO", "AG-LUCCA"],
  ["Centro", "AG-VIAREGGIO"],
  ["Città Giardino", "AG-VIAREGGIO"],
  ["Darsena", "AG-VIAREGGIO"],
  ["Ex Campo di Aviazione", "AG-VIAREGGIO"],
  ["Marco Polo", "AG-VIAREGGIO"],
  ["Migliarina", "AG-VIAREGGIO"],
  ["Terminetto", "AG-VIAREGGIO"],
  ["Torre del Lago Puccini", "AG-VIAREGGIO"],
  ["Varignano", "AG-VIAREGGIO"],
  ["XX SETTEMBRE", "AG-LIVORNO"],
  ["20 SETTEMBRE", "AG-LIVORNO"],
  ["ANTIGNANO", "AG-LIVORNO"],
  ["ARDENZA", "AG-LIVORNO"],
  ["ARDENZA TERRA", "AG-LIVORNO"],
  ["CASTELLACCIO", "AG-LIVORNO"],
  ["CENTRO STORICO", "AG-LIVORNO"],
  ["COTETO", "GUIDO"],
  ["DARSENA", "MASSIMILIANO"],
  ["FABBRICOTTI", "AG-LIVORNO"],
  ["FILZI", "VIVIANA"],
  ["FIORENTINA", "AG-LIVORNO"],
  ["GARIBALDI", "AG-LIVORNO"],
  ["ISOLA DI GORGOGNA", "AG-LIVORNO"],
  ["LA LECCIA", "AG-LIVORNO"],
  ["LE SUGHERE", "AG-LIVORNO"],
  ["MERCATO", "AG-LIVORNO"],
  ["MONTEBELLO", "AG-LIVORNO"],
  ["MONTENERO", "MATTEO"],
  ["MONTEROTONDO", "AG-LIVORNO"],
  ["PICCHIANTI", "AG-LIVORNO"],
  ["PORTA A MARE", "AG-LIVORNO"],
  ["QUERCIANELLA", "GUIDO"],
  ["SALVIANO", "AG-LIVORNO"],
  ["SCOPAIA", "AG-LIVORNO"],
  ["SHANGAI", "AG-LIVORNO"],
  ["SORGENTI", "AG-LIVORNO"],
  ["STAGNO", "AG-LIVORNO"],
  ["STAZIONE - PORTA A TERRA", "AG-LIVORNO"],
  ["VALLE BENEDETTA", "AG-LIVORNO"],
  ["VENEZIA - PONTINO", "LISA"],
  ["VENEZIA", "LISA"],
  ["PONTINO", "LISA"],
];

const HARD_CODED_ZONE_SHEET_MAPPING_RAW = HARD_CODED_ZONE_SHEET_MAPPING.map(
  ([zone, sheetTitle]) => `${zone}\t${sheetTitle}`,
).join("\n");

const zoneRuleSchema = z.object({
  name: z.string().optional(),
  pattern: z.string().min(1),
  match: z.enum(["contains", "equals", "regex"]),
  spreadsheetId: z.string().min(1),
  sheetTitle: z.string().min(1),
});

function parseEnvBoolean(input: string | undefined): boolean {
  if (input == null) return false;
  const normalized = input.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}

export const rawEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.string().optional(),
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY obbligatoria"),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),

  /** Dettagli annunci: da tabella `gestim_listings` (consigliato) oppure API HTTP legacy. */
  LISTING_SOURCE: z.enum(["api", "database"]).default("database"),
  /** Obbligatorio solo se LISTING_SOURCE=api */
  GESTIM_API_BASE_URL: z.string().url().optional(),
  /** Connessione PostgreSQL: una tra DATABASE_URL oppure DB_HOST + DB_USER + DB_PASSWORD + DB_NAME */
  DATABASE_URL: z.string().optional(),
  DB_HOST: z.string().optional(),
  DB_PORT: z.coerce.number().optional(),
  DB_USER: z.string().optional(),
  DB_PASSWORD: z.string().optional(),
  DB_NAME: z.string().optional(),
  /** "true" / "1" abilita TLS senza PEM dedicato (solo se TLS_CERT non è impostato) */
  DB_SSL: z
    .string()
    .optional()
    .transform(parseEnvBoolean),
  /** PEM della CA (o catena) per verificare il certificato del server; supporta `\n` letterali */
  TLS_CERT: z.string().optional(),

  /** Alternativa al foglio "mapping": regole JSON */
  ZONE_SHEET_MAP_JSON: z.string().default("[]"),
  /** Mapping hardcoded (default) stile test python: righe tab-delimitate zona<TAB>foglio */
  ZONE_SHEET_MAPPING_RAW: z.string().default(HARD_CODED_ZONE_SHEET_MAPPING_RAW),

  /** Se impostato, colonne A–B del tab leggono zona → nome foglio (stesso file). */
  MAPPING_SPREADSHEET_ID: z.string().optional(),
  MAPPING_SHEET_NAME: z.string().default("mapping"),
  /** Allineato al test Python (`IMAP_ZONE_MATCH=contains`). */
  MAPPING_ZONE_MATCH: z.enum(["contains", "equals"]).default("contains"),

  /** Obbligatorio se non usi solo MAPPING_SPREADSHEET_ID (viene defaultato al mapping file). */
  DEFAULT_SPREADSHEET_ID: z.string().optional(),
  DEFAULT_SHEET_TITLE: z.string().min(1).default("AG-PISA"),

  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),

  NO_ID_FOUND_SHEET_TITLE: z.string().default("no-id-trovato"),
  BLOCKED_EMAIL_SUBSTRINGS: z.string().default(
    "immobiliare,noreply,no-reply,idealista,gruppoinsieme,mailer-daemon",
  ),

  EXTRA_ID_REGEX: z.string().optional(),

  /** Outbound SMTP per risposta automatica lead. */
  SMTP_HOST: z.string().min(1, "SMTP_HOST obbligatorio"),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z
    .string()
    .optional()
    .transform((s) => (s == null ? false : s === "true" || s === "1")),
  SMTP_USER: z.string().min(1, "SMTP_USER obbligatorio"),
  SMTP_PASSWORD: z.string().min(1, "SMTP_PASSWORD obbligatorio"),
  SMTP_FROM: z.string().email("SMTP_FROM deve essere una email valida"),

  /** Se valorizzato, forza l'invio delle auto-risposte a questa casella (debug). */
  LEAD_REPLY_FORCE_TO: z.union([z.string().email(), z.literal("")]).default(""),
  /** Contatto agenzia usato per tab AG / AG-* (override opzionale dei default hardcoded). */
  AGENCY_REPLY_PHONE: z.string().optional(),
  AGENCY_REPLY_EMAIL: z.string().email().optional(),
  /**
   * Mappa contatti agenti per nome sheet.
   * Esempio:
   * {"EROS":{"phone":"+3900000000","email":"eros@dominio.it"}}
   */
  AGENT_REPLY_CONTACTS_JSON: z.string().default("{}"),

  /** Worker IMAP Aruba (sorgente inbox). */
  IMAP_EMAIL: z.string().optional(),
  IMAP_PASSWORD: z.string().optional(),
  IMAP_SERVER: z.string().default("imaps.aruba.it"),
  IMAP_PORT: z.coerce.number().default(993),
  IMAP_SECURE: z
    .string()
    .optional()
    .transform((s) => (s == null ? true : s === "true" || s === "1")),
  /** Finestra IMAP in ore (default 1 = ultima ora). */
  IMAP_LOOKBACK_HOURS: z.coerce.number().min(1).default(1),
  /** Numero massimo di messaggi processati per ciclo (allineato al test). */
  IMAP_FETCH_LIMIT: z.coerce.number().min(1).max(1000).default(200),

  WORKER_POLL_INTERVAL_MINUTES: z.coerce.number().min(5).default(60),
});

export type RawEnv = z.infer<typeof rawEnvSchema>;

export type AppEnv = RawEnv & {
  zoneSheetRules: ZoneSheetRule[];
  /** Sempre valorizzato dopo bootstrap */
  defaultSpreadsheetIdResolved: string;
};

function parseZoneMapJson(json: string): ZoneSheetRule[] {
  const raw = JSON.parse(json) as unknown;
  const arr = z.array(zoneRuleSchema).parse(raw);
  return arr;
}

function normalizeZone(zone: string): string {
  return zone.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Allineato al test Python `_resolve_sheet_for_zone`: ogni regola usa
 * `MAPPING_ZONE_MATCH` (default `contains`); con `contains`, le chiavi più
 * lunghe vengono valutate prima per evitare match parziali troppo aggressivi.
 */
function parseZoneMappingRaw(
  raw: string,
  spreadsheetId: string,
  matchMode: "contains" | "equals",
): ZoneSheetRule[] {
  const rules: ZoneSheetRule[] = [];
  const rows = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const row of rows) {
    const cells = row
      .split("\t")
      .map((cell) => cell.trim())
      .filter(Boolean);
    if (cells.length < 2) continue;
    if (cells.length % 2 !== 0) {
      throw new Error(`ZONE_SHEET_MAPPING_RAW non valido: colonne dispari nella riga "${row}"`);
    }
    for (let i = 0; i < cells.length; i += 2) {
      const zone = cells[i]!;
      const sheetTitle = cells[i + 1]!;
      rules.push({
        name: `raw_mapping_${normalizeZone(zone).replace(/\s+/g, "_")}`,
        pattern: zone,
        match: matchMode,
        spreadsheetId,
        sheetTitle,
      });
    }
  }

  if (matchMode === "contains") {
    rules.sort((a, b) => b.pattern.length - a.pattern.length);
  }
  return rules;
}

function validateGoogleCreds(r: RawEnv): void {
  if (!r.GOOGLE_APPLICATION_CREDENTIALS && !r.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new Error(
      "Impostare GOOGLE_APPLICATION_CREDENTIALS (path) oppure GOOGLE_SERVICE_ACCOUNT_JSON",
    );
  }
}

/**
 * Legge env e costruisce `zoneSheetRules` da JSON o dal foglio Google "mapping".
 */
export async function bootstrapEnv(): Promise<AppEnv> {
  const parsed = rawEnvSchema.parse(process.env);
  validateGoogleCreds(parsed);

  if (parsed.LISTING_SOURCE === "database" && !hasDatabaseConnection(parsed)) {
    throw new Error(
      "LISTING_SOURCE=database richiede DATABASE_URL oppure DB_HOST, DB_USER, DB_PASSWORD, DB_NAME",
    );
  }
  if (parsed.LISTING_SOURCE === "api" && !parsed.GESTIM_API_BASE_URL) {
    throw new Error("LISTING_SOURCE=api richiede GESTIM_API_BASE_URL");
  }

  let zoneSheetRules: ZoneSheetRule[];
  let defaultSpreadsheetIdResolved: string;
  const hasJsonMapping = parsed.ZONE_SHEET_MAP_JSON.trim() !== "[]";
  const hasRawMapping = Boolean(parsed.ZONE_SHEET_MAPPING_RAW?.trim());

  if (hasRawMapping || hasJsonMapping) {
    defaultSpreadsheetIdResolved =
      parsed.DEFAULT_SPREADSHEET_ID ?? parsed.MAPPING_SPREADSHEET_ID ?? "";
    if (!defaultSpreadsheetIdResolved) {
      throw new Error(
        "Con ZONE_SHEET_MAPPING_RAW/ZONE_SHEET_MAP_JSON devi impostare DEFAULT_SPREADSHEET_ID oppure MAPPING_SPREADSHEET_ID",
      );
    }
    if (hasRawMapping) {
      zoneSheetRules = parseZoneMappingRaw(
        parsed.ZONE_SHEET_MAPPING_RAW ?? "",
        defaultSpreadsheetIdResolved,
        parsed.MAPPING_ZONE_MATCH,
      );
      if (zoneSheetRules.length === 0) {
        throw new Error("ZONE_SHEET_MAPPING_RAW impostato ma senza righe valide");
      }
    } else {
      try {
        zoneSheetRules = parseZoneMapJson(parsed.ZONE_SHEET_MAP_JSON);
      } catch (e) {
        throw new Error(
          `ZONE_SHEET_MAP_JSON non valido: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      if (zoneSheetRules.length === 0) {
        throw new Error("ZONE_SHEET_MAP_JSON impostato ma senza regole valide");
      }
    }
  } else if (parsed.MAPPING_SPREADSHEET_ID) {
    zoneSheetRules = await loadZoneMappingFromSheet({
      spreadsheetId: parsed.MAPPING_SPREADSHEET_ID,
      sheetName: parsed.MAPPING_SHEET_NAME,
      matchMode: parsed.MAPPING_ZONE_MATCH,
    });
    if (zoneSheetRules.length === 0) {
      logger.warn(
        "Foglio mapping vuoto o senza righe A:B valide: userai solo DEFAULT_SHEET_TITLE.",
      );
    }
    defaultSpreadsheetIdResolved =
      parsed.DEFAULT_SPREADSHEET_ID ?? parsed.MAPPING_SPREADSHEET_ID;
  } else {
    try {
      zoneSheetRules = parseZoneMapJson(parsed.ZONE_SHEET_MAP_JSON);
    } catch (e) {
      throw new Error(
        `ZONE_SHEET_MAP_JSON non valido: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (zoneSheetRules.length === 0) {
      throw new Error(
        "Impostare MAPPING_SPREADSHEET_ID oppure ZONE_SHEET_MAP_JSON con almeno una regola",
      );
    }
    if (!parsed.DEFAULT_SPREADSHEET_ID) {
      throw new Error("DEFAULT_SPREADSHEET_ID obbligatorio se non usi MAPPING_SPREADSHEET_ID");
    }
    defaultSpreadsheetIdResolved = parsed.DEFAULT_SPREADSHEET_ID;
  }

  return {
    ...parsed,
    zoneSheetRules,
    defaultSpreadsheetIdResolved,
  };
}

/** @deprecated Usare bootstrapEnv. Solo per test che non caricano il mapping da sheet. */
export function loadEnvFromJsonOnly(zoneSheetRules: ZoneSheetRule[], overrides: Partial<RawEnv> = {}): AppEnv {
  const parsed = rawEnvSchema.parse({ ...process.env, ...overrides });
  validateGoogleCreds(parsed);
  const defaultSpreadsheetIdResolved =
    parsed.DEFAULT_SPREADSHEET_ID ?? parsed.MAPPING_SPREADSHEET_ID ?? "test-default";
  return { ...parsed, zoneSheetRules, defaultSpreadsheetIdResolved };
}
