/* ==========================================================================
   ELDOSTORE CRM — Inventario real (data/inventario-real.js)

   Fuente: ELDOSTORE_inventario_real_117_productos.csv, provisto por el
   dueño del negocio. Se cargó tal cual: mismos códigos, nombres, costos,
   precios y stock. No se inventó ni corrigió ningún valor.

   La columna 'categoria' venía vacía en las 117 filas del archivo original,
   así que se dejó vacía (no se asignó ninguna categoría de las 8 del sitio
   público) y cada producto queda marcado como 'revisar' para que se le
   asigne la categoría correcta desde el panel cuando se pueda.

   La columna 'stockMin' tampoco venía en el archivo: se dejó en 0 y también
   queda marcada para revisar, para no inventar un mínimo de stock que el
   dueño no definió.
   ========================================================================== */

const INVENTARIO_REAL_ELDOSTORE = [
  {
    "codigo": "001",
    "nombre": "Triturador manual Home Land 500 ml",
    "categoria": "",
    "costo": 3925.0,
    "precio": 9000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "002",
    "nombre": "Cortador de verduras One Step",
    "categoria": "",
    "costo": 10990.0,
    "precio": 22000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "003",
    "nombre": "Licuadora Home Land Easy 1600 ml",
    "categoria": "",
    "costo": 18840.0,
    "precio": 36000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "004",
    "nombre": "Hand Blender Hoffmans HM-8037 800W",
    "categoria": "",
    "costo": 10990.0,
    "precio": 22000.0,
    "stock": 2.0,
    "stockMin": 0
  },
  {
    "codigo": "005",
    "nombre": "Set cubiertos Tramontina Ipanema 30 piezas",
    "categoria": "",
    "costo": 20140.0,
    "precio": 30000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "006",
    "nombre": "Sandwichera RAF R.251 750W",
    "categoria": "",
    "costo": 15700.0,
    "precio": 30000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "007",
    "nombre": "Licuadora portátil Bigstar Plus 380 ml",
    "categoria": "",
    "costo": 3925.0,
    "precio": 10000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "008",
    "nombre": "Set de vasos Gamma 6 piezas / 300 ml",
    "categoria": "",
    "costo": 3150.0,
    "precio": 5500.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "009",
    "nombre": "Stereo para auto MegaStar CDX259BT",
    "categoria": "",
    "costo": 16956.0,
    "precio": 30000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "010",
    "nombre": "Quencher / vaso térmico con sorbete 1200 ml",
    "categoria": "",
    "costo": 7850.0,
    "precio": 16000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "011",
    "nombre": "Plancha de vapor Ackiliss ACL-61170B 1200W",
    "categoria": "",
    "costo": 12560.0,
    "precio": 22000.0,
    "stock": 2.0,
    "stockMin": 0
  },
  {
    "codigo": "012",
    "nombre": "Power Bank Ecopower Smart Charge 12000 mAh",
    "categoria": "",
    "costo": 10200.0,
    "precio": 19000.0,
    "stock": 2.0,
    "stockMin": 0
  },
  {
    "codigo": "013",
    "nombre": "TV Stick MGS TVR3 Android TV",
    "categoria": "",
    "costo": 23550.0,
    "precio": 42000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "014",
    "nombre": "TV Stick Lukystar Android TV",
    "categoria": "",
    "costo": 18900.0,
    "precio": 35000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "015",
    "nombre": "Cabina de uñas SUN C8 Plus 256W",
    "categoria": "",
    "costo": 23550.0,
    "precio": 42000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "016",
    "nombre": "Parlante GO3 Wireless V5.1",
    "categoria": "",
    "costo": 9420.0,
    "precio": 16500.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "017",
    "nombre": "Parlante Blulory BS-801",
    "categoria": "",
    "costo": 7850.0,
    "precio": 18000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "018",
    "nombre": "Parlante Soonbox S19",
    "categoria": "",
    "costo": 5500.0,
    "precio": 13000.0,
    "stock": 2.0,
    "stockMin": 0
  },
  {
    "codigo": "019",
    "nombre": "Nebulizador Mesh HH-W302PLUS",
    "categoria": "",
    "costo": 8442.0,
    "precio": 15600.0,
    "stock": 2.0,
    "stockMin": 0
  },
  {
    "codigo": "020",
    "nombre": "Vaso de café 500 ml",
    "categoria": "",
    "costo": 7850.0,
    "precio": 14000.0,
    "stock": 2.0,
    "stockMin": 0
  },
  {
    "codigo": "021",
    "nombre": "Soporte magnético LUKTON",
    "categoria": "",
    "costo": 3100.0,
    "precio": 6500.0,
    "stock": 2.0,
    "stockMin": 0
  },
  {
    "codigo": "022",
    "nombre": "Oxímetro LK87",
    "categoria": "",
    "costo": 3900.0,
    "precio": 7000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "023",
    "nombre": "Cámara inteligente Velds",
    "categoria": "",
    "costo": 8636.0,
    "precio": 17000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "024",
    "nombre": "Kit mate 1L + mate 160 ml",
    "categoria": "",
    "costo": 14130.0,
    "precio": 23000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "025",
    "nombre": "Control PS3",
    "categoria": "",
    "costo": 10200.0,
    "precio": 16500.0,
    "stock": 2.0,
    "stockMin": 0
  },
  {
    "codigo": "026",
    "nombre": "Linterna para bici",
    "categoria": "",
    "costo": 2300.0,
    "precio": 6000.0,
    "stock": 2.0,
    "stockMin": 0
  },
  {
    "codigo": "027",
    "nombre": "Maquinita de cabello LU-4645",
    "categoria": "",
    "costo": 3700.0,
    "precio": 11500.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "028",
    "nombre": "Maquinita de cabello LU-3642",
    "categoria": "",
    "costo": 4700.0,
    "precio": 13000.0,
    "stock": 2.0,
    "stockMin": 0
  },
  {
    "codigo": "029",
    "nombre": "Maquinita Iwoo",
    "categoria": "",
    "costo": 4300.0,
    "precio": 8000.0,
    "stock": 4.0,
    "stockMin": 0
  },
  {
    "codigo": "030",
    "nombre": "Linterna Ecopower EP-8139",
    "categoria": "",
    "costo": 4500.0,
    "precio": 10000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "031",
    "nombre": "Linterna Ecopower EP-8147",
    "categoria": "",
    "costo": 3000.0,
    "precio": 8000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "032",
    "nombre": "Humidificador gatito",
    "categoria": "",
    "costo": 4700.0,
    "precio": 9000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "033",
    "nombre": "Mini teclado inalámbrico",
    "categoria": "",
    "costo": 3100.0,
    "precio": 8000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "034",
    "nombre": "Cortina de baño",
    "categoria": "",
    "costo": 1200.0,
    "precio": 3000.0,
    "stock": 2.0,
    "stockMin": 0
  },
  {
    "codigo": "035",
    "nombre": "Timbre inalámbrico",
    "categoria": "",
    "costo": 3900.0,
    "precio": 7000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "036",
    "nombre": "Secadora de cabello Bopai 4 en 1",
    "categoria": "",
    "costo": 12560.0,
    "precio": 24000.0,
    "stock": 2.0,
    "stockMin": 0
  },
  {
    "codigo": "037",
    "nombre": "Auriculares inalámbricos Audisat",
    "categoria": "",
    "costo": 8600.0,
    "precio": 15000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "038",
    "nombre": "Picana eléctrica",
    "categoria": "",
    "costo": 6280.0,
    "precio": 10000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "039",
    "nombre": "Luz para celular",
    "categoria": "",
    "costo": 5400.0,
    "precio": 10000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "040",
    "nombre": "Micrófono para celular",
    "categoria": "",
    "costo": 7065.0,
    "precio": 12000.0,
    "stock": 2.0,
    "stockMin": 0
  },
  {
    "codigo": "041",
    "nombre": "Planchita 3 en 1 Kemei",
    "categoria": "",
    "costo": 10990.0,
    "precio": 19000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "042",
    "nombre": "Planchita 3 en 1 Titanium",
    "categoria": "",
    "costo": 15700.0,
    "precio": 28000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "043",
    "nombre": "Balanza de cocina Lustar 30 kg",
    "categoria": "",
    "costo": 20400.0,
    "precio": 39000.0,
    "stock": 0.0,
    "stockMin": 0
  },
  {
    "codigo": "044",
    "nombre": "Set corta uñas 12 piezas",
    "categoria": "",
    "costo": 2000.0,
    "precio": 10000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "045",
    "nombre": "Smartwatch 5 en 1 Mini",
    "categoria": "",
    "costo": 10000.0,
    "precio": 24000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "046",
    "nombre": "Soporte TV móvil 32 a 55 pulgadas",
    "categoria": "",
    "costo": 10990.0,
    "precio": 20000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "047",
    "nombre": "Licuadora de vidrio",
    "categoria": "",
    "costo": 23550.0,
    "precio": 45000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "048",
    "nombre": "Pava eléctrica de vidrio MOX",
    "categoria": "",
    "costo": 12560.0,
    "precio": 23000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "049",
    "nombre": "Escurridor de platos 2 niveles",
    "categoria": "",
    "costo": 18840.0,
    "precio": 29000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "050",
    "nombre": "Cubre moto / funda",
    "categoria": "",
    "costo": 5900.0,
    "precio": 10000.0,
    "stock": 2.0,
    "stockMin": 0
  },
  {
    "codigo": "051",
    "nombre": "Candado para moto Kihuu",
    "categoria": "",
    "costo": 5490.0,
    "precio": 13000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "052",
    "nombre": "Candado de moto fino Motorcycle",
    "categoria": "",
    "costo": 4700.0,
    "precio": 11000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "053",
    "nombre": "Paraguas para auto",
    "categoria": "",
    "costo": 7890.0,
    "precio": 15000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "054",
    "nombre": "Planchita de cabello alisadora",
    "categoria": "",
    "costo": 3100.0,
    "precio": 15000.0,
    "stock": 2.0,
    "stockMin": 0
  },
  {
    "codigo": "055",
    "nombre": "Planchita de cabello Ackiliss",
    "categoria": "",
    "costo": 9420.0,
    "precio": 17000.0,
    "stock": 2.0,
    "stockMin": 0
  },
  {
    "codigo": "056",
    "nombre": "Vaso cervecero",
    "categoria": "",
    "costo": 3700.0,
    "precio": 10000.0,
    "stock": 2.0,
    "stockMin": 0
  },
  {
    "codigo": "057",
    "nombre": "Quencher floreado 1,2 L",
    "categoria": "",
    "costo": 12500.0,
    "precio": 20000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "058",
    "nombre": "Botellita de agua 650 ml",
    "categoria": "",
    "costo": 9400.0,
    "precio": 16000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "059",
    "nombre": "Jarra eléctrica Maxon",
    "categoria": "",
    "costo": 10200.0,
    "precio": 18500.0,
    "stock": 2.0,
    "stockMin": 0
  },
  {
    "codigo": "060",
    "nombre": "pava electrica",
    "categoria": "",
    "costo": 6000.0,
    "precio": 14500.0,
    "stock": 11.0,
    "stockMin": 0
  },
  {
    "codigo": "061",
    "nombre": "mini ventilador portatil",
    "categoria": "",
    "costo": 3070.0,
    "precio": 5000.0,
    "stock": 2.0,
    "stockMin": 0
  },
  {
    "codigo": "062",
    "nombre": "cort.verdura molino",
    "categoria": "",
    "costo": 10745.0,
    "precio": 19000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "063",
    "nombre": "mopas 360º",
    "categoria": "",
    "costo": 10745.0,
    "precio": 19000.0,
    "stock": 7.0,
    "stockMin": 0
  },
  {
    "codigo": "064",
    "nombre": "soporte tv fijo",
    "categoria": "",
    "costo": 5372.0,
    "precio": 11000.0,
    "stock": 2.0,
    "stockMin": 0
  },
  {
    "codigo": "065",
    "nombre": "aro led luz c/tripode",
    "categoria": "",
    "costo": 6140.0,
    "precio": 11000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "066",
    "nombre": "funda para auto talle M",
    "categoria": "",
    "costo": 18840.0,
    "precio": 34000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "067",
    "nombre": "batidora con bowl krab",
    "categoria": "",
    "costo": 15700.0,
    "precio": 28500.0,
    "stock": 2.0,
    "stockMin": 0
  },
  {
    "codigo": "068",
    "nombre": "tv stick ferrox",
    "categoria": "",
    "costo": 19200.0,
    "precio": 35500.0,
    "stock": 2.0,
    "stockMin": 0
  },
  {
    "codigo": "069",
    "nombre": "balanza corporal hasta 180kg",
    "categoria": "",
    "costo": 7457.0,
    "precio": 14000.0,
    "stock": 5.0,
    "stockMin": 0
  },
  {
    "codigo": "070",
    "nombre": "cargdor inalambrico iphone",
    "categoria": "",
    "costo": 9027.0,
    "precio": 16500.0,
    "stock": 4.0,
    "stockMin": 0
  },
  {
    "codigo": "071",
    "nombre": "humidificador ventilador",
    "categoria": "",
    "costo": 8635.0,
    "precio": 15600.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "072",
    "nombre": "mini aspirador vacum 3en1",
    "categoria": "",
    "costo": 7065.0,
    "precio": 13000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "073",
    "nombre": "secador cabello mannatech",
    "categoria": "",
    "costo": 9800.0,
    "precio": 18000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "074",
    "nombre": "smartwach serie 11",
    "categoria": "",
    "costo": 10600.0,
    "precio": 21000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "075",
    "nombre": "planchita azul 450º",
    "categoria": "",
    "costo": 10990.0,
    "precio": 20000.0,
    "stock": 4.0,
    "stockMin": 0
  },
  {
    "codigo": "076",
    "nombre": "planchita middiv",
    "categoria": "",
    "costo": 7675.0,
    "precio": 14000.0,
    "stock": 3.0,
    "stockMin": 0
  },
  {
    "codigo": "077",
    "nombre": "mini aspirador 4en1",
    "categoria": "",
    "costo": 6523.0,
    "precio": 13000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "078",
    "nombre": "bola de cristal",
    "categoria": "",
    "costo": 7444.0,
    "precio": 13500.0,
    "stock": 3.0,
    "stockMin": 0
  },
  {
    "codigo": "079",
    "nombre": "cable de iphone",
    "categoria": "",
    "costo": 1020.0,
    "precio": 3500.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "080",
    "nombre": "secador de cabello zumba 5en1",
    "categoria": "",
    "costo": 10990.0,
    "precio": 23000.0,
    "stock": 4.0,
    "stockMin": 0
  },
  {
    "codigo": "081",
    "nombre": "cargador comun",
    "categoria": "",
    "costo": 2747.0,
    "precio": 5000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "082",
    "nombre": "depilador de nariz",
    "categoria": "",
    "costo": 2826.0,
    "precio": 5000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "083",
    "nombre": "candado con alarma",
    "categoria": "",
    "costo": 5887.0,
    "precio": 11500.0,
    "stock": 3.0,
    "stockMin": 0
  },
  {
    "codigo": "084",
    "nombre": "candado boalink",
    "categoria": "",
    "costo": 4160.0,
    "precio": 7500.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "085",
    "nombre": "luces bici x2",
    "categoria": "",
    "costo": 3532.0,
    "precio": 7000.0,
    "stock": 2.0,
    "stockMin": 0
  },
  {
    "codigo": "086",
    "nombre": "cargdor eco tiò C",
    "categoria": "",
    "costo": 2276.0,
    "precio": 6000.0,
    "stock": 2.0,
    "stockMin": 0
  },
  {
    "codigo": "087",
    "nombre": "peine secador 5en1",
    "categoria": "",
    "costo": 12560.0,
    "precio": 25000.0,
    "stock": 4.0,
    "stockMin": 0
  },
  {
    "codigo": "088",
    "nombre": "balanza de cocina 10kg",
    "categoria": "",
    "costo": 4710.0,
    "precio": 9000.0,
    "stock": 2.0,
    "stockMin": 0
  },
  {
    "codigo": "089",
    "nombre": "pilas AA+",
    "categoria": "",
    "costo": 1334.0,
    "precio": 2800.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "090",
    "nombre": "PILAS AAA+",
    "categoria": "",
    "costo": 1334.0,
    "precio": 2500.0,
    "stock": 2.0,
    "stockMin": 0
  },
  {
    "codigo": "091",
    "nombre": "cuchillo blanco",
    "categoria": "",
    "costo": 2041.0,
    "precio": 5800.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "092",
    "nombre": "soporte auto inova",
    "categoria": "",
    "costo": 4082.0,
    "precio": 9000.0,
    "stock": 2.0,
    "stockMin": 0
  },
  {
    "codigo": "093",
    "nombre": "inflador de auto digital",
    "categoria": "",
    "costo": 19625.0,
    "precio": 35000.0,
    "stock": 2.0,
    "stockMin": 0
  },
  {
    "codigo": "094",
    "nombre": "termometro digital",
    "categoria": "",
    "costo": 3532.0,
    "precio": 7000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "095",
    "nombre": "cepillo electrico henga",
    "categoria": "",
    "costo": 3925.0,
    "precio": 7000.0,
    "stock": 2.0,
    "stockMin": 0
  },
  {
    "codigo": "096",
    "nombre": "tostadora 2 panes",
    "categoria": "",
    "costo": 14915.0,
    "precio": 26800.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "097",
    "nombre": "streo de auto krab",
    "categoria": "",
    "costo": 11225.0,
    "precio": 21000.0,
    "stock": 4.0,
    "stockMin": 0
  },
  {
    "codigo": "098",
    "nombre": "balanza cocina 5kg",
    "categoria": "",
    "costo": 3140.0,
    "precio": 6000.0,
    "stock": 2.0,
    "stockMin": 0
  },
  {
    "codigo": "099",
    "nombre": "control ps4",
    "categoria": "",
    "costo": 19625.0,
    "precio": 35000.0,
    "stock": 2.0,
    "stockMin": 0
  },
  {
    "codigo": "100",
    "nombre": "set de silicona cocina",
    "categoria": "",
    "costo": 17270.0,
    "precio": 33000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "101",
    "nombre": "secador de cabello maxon",
    "categoria": "",
    "costo": 9420.0,
    "precio": 21000.0,
    "stock": 2.0,
    "stockMin": 0
  },
  {
    "codigo": "102",
    "nombre": "parlante pluse 4",
    "categoria": "",
    "costo": 7850.0,
    "precio": 14000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "103",
    "nombre": "cabina de uñas 54w",
    "categoria": "",
    "costo": 9420.0,
    "precio": 21000.0,
    "stock": 2.0,
    "stockMin": 0
  },
  {
    "codigo": "104",
    "nombre": "plancha ackiliss",
    "categoria": "",
    "costo": 10990.0,
    "precio": 20000.0,
    "stock": 4.0,
    "stockMin": 0
  },
  {
    "codigo": "105",
    "nombre": "tensiometro digital",
    "categoria": "",
    "costo": 11000.0,
    "precio": 23000.0,
    "stock": 3.0,
    "stockMin": 0
  },
  {
    "codigo": "106",
    "nombre": "batidora de mano",
    "categoria": "",
    "costo": 7850.0,
    "precio": 14500.0,
    "stock": 4.0,
    "stockMin": 0
  },
  {
    "codigo": "107",
    "nombre": "barbeador 3 en 1 DL-9007",
    "categoria": "",
    "costo": 9420.0,
    "precio": 20000.0,
    "stock": 2.0,
    "stockMin": 0
  },
  {
    "codigo": "108",
    "nombre": "barbeador 3 en 1 DL-9050",
    "categoria": "",
    "costo": 12400.0,
    "precio": 22500.0,
    "stock": 4.0,
    "stockMin": 0
  },
  {
    "codigo": "109",
    "nombre": "maquinira roadstar clasica",
    "categoria": "",
    "costo": 7500.0,
    "precio": 13600.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "110",
    "nombre": "maqinita para mascotas",
    "categoria": "",
    "costo": 8600.0,
    "precio": 15500.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "111",
    "nombre": "maquinita LU-4643",
    "categoria": "",
    "costo": 3900.0,
    "precio": 7500.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "112",
    "nombre": "maquinita aircliper",
    "categoria": "",
    "costo": 6100.0,
    "precio": 11000.0,
    "stock": 8.0,
    "stockMin": 0
  },
  {
    "codigo": "113",
    "nombre": "depiladora mujer 4 en 1",
    "categoria": "",
    "costo": 11000.0,
    "precio": 22000.0,
    "stock": 3.0,
    "stockMin": 0
  },
  {
    "codigo": "114",
    "nombre": "depiladora mujer comun",
    "categoria": "",
    "costo": 9400.0,
    "precio": 17000.0,
    "stock": 1.0,
    "stockMin": 0
  },
  {
    "codigo": "115",
    "nombre": "cargadro iphone",
    "categoria": "",
    "costo": 3140.0,
    "precio": 12000.0,
    "stock": 3.0,
    "stockMin": 0
  },
  {
    "codigo": "116",
    "nombre": "cargador tipo c 120w",
    "categoria": "",
    "costo": 5650.0,
    "precio": 10000.0,
    "stock": 3.0,
    "stockMin": 0
  },
  {
    "codigo": "117",
    "nombre": "ventilador 5 aletas",
    "categoria": "",
    "costo": 18800.0,
    "precio": 33500.0,
    "stock": 9.0,
    "stockMin": 0
  }
];
