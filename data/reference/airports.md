# SKYPACT airport reference facts: OMAA, OMDB, OMSJ

Generated 2026-10-26. Machine-readable copy: `airports.json` (same content). Every value carries its source URL inline.

## Notes

- Aeronautical data (ARP, elevation, MAG VAR, runways, thresholds, declared distances, obstacle heights) are from the UAE GCAA eAIP AD 2 pages, AIRAC AMDT 12/2026 package (published 15 OCT 2026, effective 26 NOV 2026). They were diffed against the AMDT 09/2026 package in force on 2026-10-26: AD 2.2/2.12/2.13 are identical except the OMDB MAG VAR entry and a new OMSJ runway-maintenance remark.
- Coordinates are WGS-84. AIP DMS strings are kept in aip_dms; decimals converted exactly. Feet converted with 0.3048 m/ft.
- true_bearings_deg are the AIP-published true bearings (integers for OMAA/OMDB, 2 decimals for OMSJ). true_bearings_deg_computed and length_m_computed_* are geodesic values (WGS-84, Vincenty inverse) computed by us from the AIP threshold/runway-end coordinates.
- thresholds[].lat/lon are the landing thresholds (displaced where displaced_m > 0). For OMDB and OMSJ the physical pavement ends are in runway_ends.
- Building dimensions marked approximate/OSM come from OpenStreetMap (ODbL 1.0, (c) OpenStreetMap contributors) and are cross-check values only; pipeline/osm is the authoritative footprint source.
- Photos: only Wikimedia Commons files licensed CC BY, CC BY-SA, CC0 or public domain were kept. License, author and date were read from each file page via the Commons API (extmetadata) on 2026-10-26 and spot-checked on the HTML file pages. GFDL-only files (e.g. the Airliners.net "AN" series) and Free Art License files were excluded. No image files were downloaded. Attribution (author + license) is required for CC BY / CC BY-SA images; CC BY-SA requires share-alike for adaptations.
- The diagrams lists (extra key) hold openly licensed layout diagrams, not photos.
- Some pages could not be fetched (DAEP: Cloudflare check; Archnet: Vercel bot check; adairports.ae: 403; WAM/TradeArabia: unavailable). Facts attributed to those URLs come from search-engine result text and are flagged in the descriptions.
- Conflicting values are listed side by side (alt_values / *_alt_values) with sources; the preferred value is the primary source (AIP, operator fact file, architect).

## Summary

| Airport | ARP lat, lon (dec. deg, WGS-84) | AIP DMS | Elevation | Runways (designators, L x W m, true brg AIP, surface) |
|---|---|---|---|---|
| OMAA/AUH Zayed International Airport | 24.43306, 54.65111 | 242559N 0543904E | 83 ft / 25.3 m | 13R/31L 4106 x 60, 128/308 deg T, asphalt; 13L/31R 4100 x 60, 128/308 deg T, asphalt |
| OMDB/DXB Dubai International Airport | 25.25278, 55.36444 | 251510N 0552152E | 62 ft / 18.9 m | 12R/30L 4447 x 60, 121/301 deg T, asphalt; 12L/30R 4351 x 60, 121/301 deg T, asphalt |
| OMSJ/SHJ Sharjah International Airport | 25.32917, 55.51611 | 251945N 0553058E | 119 ft / 36.3 m | 12/30 4060 x 60, 122.37/302.38 deg T, asphalt |

Source for every value in this table: the UAE GCAA eAIP AD 2 page of each airport, AD 2.2 and AD 2.12, linked in the airport sections below.

## OMAA / AUH: Zayed International Airport

- Former names: Abu Dhabi International Airport (renamed Zayed International Airport on 9 February 2024)
- AIP name: ABU DHABI / ZAYED INTERNATIONAL; city: Abu Dhabi
- ARP: **24.4330556, 54.6511111** (AIP `242559N 0543904E`; site: Mid point of RWY 13R/31L, on CL). Source: [GCAA eAIP AD 2.2](https://www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/html/eAIP/AD-2.OMAA-en-GB.html#OMAA-AD-2.2)
  - Cross-check: 24°25′59″N 054°39′04″E (24.43306, 54.65111) (same as AIP), [Wikipedia](https://en.wikipedia.org/wiki/Zayed_International_Airport)
- Aerodrome elevation: **83 ft / 25.3 m AMSL**; reference temperature 38 C; geoid undulation -109 ft. Source: [GCAA eAIP AD 2.2](https://www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/html/eAIP/AD-2.OMAA-en-GB.html#OMAA-AD-2.2)
  - Other value: 88 ft / 27 m (Wikipedia infobox differs from AIP; use AIP), [Wikipedia](https://en.wikipedia.org/wiki/Zayed_International_Airport)
- Magnetic variation: **2.0 deg E (2017)**, annual change 0.05 deg E. Source: [GCAA eAIP AD 2.2](https://www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/html/eAIP/AD-2.OMAA-en-GB.html#OMAA-AD-2.2)
- Aerodrome reference code: 4F (AIP AD 2.2 remarks)

### Runways

| Runway | Length x width (m) | True bearing, AIP (deg) | True bearing, computed (deg) | Mag. bearing (deg) | Surface / PCR | Displaced THR (m) | Declared distances TORA / TODA / ASDA / LDA (m) |
|---|---|---|---|---|---|---|---|
| 13R/31L | 4106 x 60 | 128/308 | 127.78/307.79 | 126/306 | asphalt / 680/F/A/W/U | 13R: 0, 31L: 0 | 13R: 4106 / 4526 / 4106 / 4106<br>31L: 4106 / 4486 / 4106 / 4106 |
| 13L/31R | 4100 x 60 | 128/308 | 127.78/307.79 | 126/306 | asphalt / 1010/F/A/W/T | 13L: 0, 31R: 0 | 13L: 4100 / 4400 / 4100 / 4100<br>31R: 4100 / 4400 / 4100 / 4100 |

Thresholds (landing thresholds; displaced where noted):

| THR | Lat | Lon | AIP DMS | Elevation | Displaced (m) |
|---|---|---|---|---|---|
| 13R | 24.4444111 | 54.6351861 | `242639.88N 0543806.67E` | 78 ft / 23.77 m | 0 |
| 31L | 24.4217000 | 54.6671833 | `242518.12N 0544001.86E` | 83 ft / 25.3 m | 0 |
| 13L | 24.4650806 | 54.6382528 | `242754.29N 0543817.71E` | 62 ft / 18.9 m | 0 |
| 31R | 24.4424000 | 54.6702111 | `242632.64N 0544012.76E` | 72 ft / 21.95 m | 0 |

- 13R/31L geodesic length from AIP coordinates: 4105.7 m. Notes: Southern runway (the original runway, airport opened 1982). No displaced thresholds (THR = runway end; LDA = TORA). ARP lies on its centreline at mid-length. CL separation from 13L/31R = 2000 m (AIP). Closed for preventive maintenance Tue/Thu/Sat 1130-1430 UTC (AIP). Wikipedia infobox gives 4,205 m for both runways - AIP value used.
  Sources: [www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/htm...](https://www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/html/eAIP/AD-2.OMAA-en-GB.html#OMAA-AD-2.12), [www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/htm...](https://www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/html/eAIP/AD-2.OMAA-en-GB.html#OMAA-AD-2.13), [www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P08/htm...](https://www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P08/html/eAIP/AD-2.OMAA-en-GB.html#OMAA-AD-2.12)
- 13L/31R geodesic length from AIP coordinates: 4100.1 m. Notes: Northern runway, opened October 2008 (Wikipedia). No displaced thresholds. Closed for preventive maintenance Mon/Wed/Fri/Sun 1130-1430 UTC (AIP). Terminal A and the ATC tower sit in the midfield between the two runways.
  Sources: [www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/htm...](https://www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/html/eAIP/AD-2.OMAA-en-GB.html#OMAA-AD-2.12), [www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/htm...](https://www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/html/eAIP/AD-2.OMAA-en-GB.html#OMAA-AD-2.13), [en.wikipedia.org/wiki/Zayed_International_Airport](https://en.wikipedia.org/wiki/Zayed_International_Airport)

### Terminals and concourses

#### Terminal A (formerly Midfield Terminal Building / Midfield Terminal Complex)

- Type: terminal; status: operational
- Opened: 2023-10-31 (official opening and first Etihad departure; all airlines operating from Terminal A from 2023-11-14)
- Floor area: 742,000 m2 Other values: 700,000 m2 (KPF project page; Hill International); 7.9 million sq ft ~ 734,000 m2 (KPF news, construction-era); over 780,000 m2 (Wikipedia, uncited).
- Gates: 51 (51 contact gates (14 MARS-capable), expandable to 65 contact gates in full MARS configuration, plus 6 remote bus gates; Terminal A apron (Apron 6) = 51 (65) contact + 14 remote stands; airport-wide 64 passenger + 30 cargo stands (ACL W26 capacity declaration, published 30/04/26). ADA/KPF: up to 79 aircraft at any one time; Hill International: piers accommodate up to 65 aircraft.)
- Capacity: 45 mppa (45 mppa today, 11,000 pax/hour; KPF: designed for up to 80 mppa.)
- Architect: Kohn Pedersen Fox Associates (KPF) - design competition won 2006
- Plan shape: X-shaped: a central processor / departure hall with four piers radiating from a central hub; piers themed desert, sea, city and oasis. KPF refined the plan from linear, Y, H and modified-X schemes; the centre was shifted to align with the runway axis and the entrance rotated toward the arrival road from downtown. Sits midfield between the two runways, raised on its own plateau above road level.
- Roof: Single continuous undulating metal roof informed by sand dunes: the arch-shaped pier geometry is pulled down at each segment, giving a wave/dune profile; roof drapes over the facade (reduces glazing, no external shading devices). Central departure hall roof carried on 18 curved steel arches (visually separated from the roof), the largest about 180 m span and 52 m high; the central arch kept low enough for aircraft to fly over.
- Dimensions (m): roof width at widest 319, largest arch span 180, largest arch height 52, departure hall height 50, landside glazed facade height 50, OSM overall extent (approx.): ~1,400 m E-W x ~1,420 m N-S; minimum bounding rectangle ~1,190 x 1,080 m; footprint ~234,000 m2 (OSM relation 20328079, ODbL; approximate)
- Height (m): 52
- Height note: Ceiling at highest point 52 m (Hill International; arch height 52 m per AviationWeek 2016); departure hall 50 m (KPF); OSM height tag 53 m; AIP obstacle "MIDFIELD TERMINAL COMPLEX" top elevation 259 ft AMSL at 242707.6N 0543825.6E (~54 m above the 83 ft aerodrome elevation; derived, approximate).
- Facade: Glass and aluminium: ~115,000 m2 external glazing and ~275,000 m2 aluminium cladding (Hill International). Free-standing 50 m tall glazed landside facade; glazed pier facades canted outward at 14.75 deg to shade the holdrooms; glass with a fading frit pattern that becomes more transparent toward the top (KPF).
- Colours: Not documented in sources: metallic (aluminium) roof and large glazed facades - take colours from the reference photos.
- Features: Column-free central departure hall with mosaic stone flooring; two four-storey buildings flank the departure hall (hotel rooms and offices) (Dezeen); "Sana Al Nour" light/air feature 22 m tall x 30 m wide made of 1,632 curved glass leaves; "The Shell" brass and Cor-Ten sculpture wrapped in glass; skylights for wayfinding; 3,400 covered short-term + 1,500 long-term parking spaces; Estidama 3 Pearl; visible from the highway >1.5 km away.
- Sources: [www.kpf.com/project/zayed-international-airport](https://www.kpf.com/project/zayed-international-airport), [www.kpf.com/news/opening-announced-for-abu-dhabi-international-airp...](https://www.kpf.com/news/opening-announced-for-abu-dhabi-international-airport-terminal-a), [www.kpf.com/news/video-footage-of-midfield-terminal-shows-kpf-proje...](https://www.kpf.com/news/video-footage-of-midfield-terminal-shows-kpf-projects-size-and-complexity), [www.hillintl.com/project/abu-dhabi-international-airport-midfield-t...](https://www.hillintl.com/project/abu-dhabi-international-airport-midfield-terminal-complex/), [aviationweek.com/air-transport/airports-networks/steel-structure-mi...](https://aviationweek.com/air-transport/airports-networks/steel-structure-midfield-terminal-building-roof-complete), [meconstructionnews.com/14067/steel-roof-structure-completed-at-midf...](https://meconstructionnews.com/14067/steel-roof-structure-completed-at-midfield-terminal-in-abu-dhabi), [www.dezeen.com/?p=2033239](https://www.dezeen.com/?p=2033239), [gulfnews.com/business/aviation/abu-dhabi-airports-terminal-a-set-to...](https://gulfnews.com/business/aviation/abu-dhabi-airports-terminal-a-set-to-begin-operations-in-november-2023-1.97835736), [www.acl-uk.org/wp-content/uploads/2026/04/W26-AUH-Capacity-Declarat...](https://www.acl-uk.org/wp-content/uploads/2026/04/W26-AUH-Capacity-Declaration-v1.0.pdf), [en.wikipedia.org/wiki/Zayed_International_Airport](https://en.wikipedia.org/wiki/Zayed_International_Airport), [www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/htm...](https://www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/html/eAIP/AD-2.OMAA-en-GB.html#OMAA-AD-2.10), [www.openstreetmap.org/relation/20328079](https://www.openstreetmap.org/relation/20328079)

#### Former Terminal 1

- Type: terminal; status: closed (all flights moved to Terminal A by 14 Nov 2023)
- Opened: 1982 (airport opened 2 January 1982)
- Floor area: n/a
- Gates: 9 (Nine jet-bridge gates (3-11) in a circular gate area plus bus gates 14-22 (Wikipedia).)
- Capacity: n/a
- Architect: n/a
- Plan shape: Main building plus a circular satellite gate area (Wikipedia). OSM outline ~330 x 300 m, footprint ~37,000 m2 (approximate).
- Features: Old ATC tower nearby (AIP obstacle "OLD ATCC TOWER" 242533.7N 0543848.6E, top 231 ft AMSL).
- Sources: [en.wikipedia.org/wiki/Zayed_International_Airport](https://en.wikipedia.org/wiki/Zayed_International_Airport), [www.openstreetmap.org/relation/7404665](https://www.openstreetmap.org/relation/7404665), [www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/htm...](https://www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/html/eAIP/AD-2.OMAA-en-GB.html#OMAA-AD-2.10)

#### Former Terminal 2

- Type: terminal; status: closed (2023)
- Opened: 2005-09
- Floor area: n/a
- Gates: n/a (Bus gates 24-26, no jet bridges (Wikipedia).)
- Capacity: n/a
- Architect: n/a
- Plan shape: Small single building; OSM footprint ~12,700 m2 (~135 x 116 m), approximate.
- Sources: [en.wikipedia.org/wiki/Zayed_International_Airport](https://en.wikipedia.org/wiki/Zayed_International_Airport), [www.openstreetmap.org/way/314047216](https://www.openstreetmap.org/way/314047216)

#### Former Terminal 3

- Type: terminal; status: closed (2023)
- Opened: 2009-01
- Floor area: n/a
- Gates: 34 (34 gates, 8 with jet bridges, 2 A380-capable (Wikipedia); interim AED 1 bn facility used mainly by Etihad.)
- Capacity: n/a
- Architect: n/a
- Plan shape: Linear building; OSM minimum bounding rectangle ~730 x 220 m, footprint ~44,600 m2 (approximate).
- Sources: [en.wikipedia.org/wiki/Zayed_International_Airport](https://en.wikipedia.org/wiki/Zayed_International_Airport), [www.openstreetmap.org/relation/7404652](https://www.openstreetmap.org/relation/7404652)

### Control towers

#### Air Traffic Control Complex (ATCC) tower

- Height: 109 m (other values: AIP AD 2.10 obstacle "OMAA AD 001 / ATCC Tower": height 378 ft (115.2 m) above ground, top elevation 455 ft AMSL (likely includes masts/appurtenances); 110 m (2006 design announcement, TradeArabia; OSM tag height=110); 109 m, 20 storeys (Gulf News c.2010; Airport Technology); 100 m (Terrell Group, structural engineer))
- Opened: 2011 (structure completed per Airport Technology / Terrell; earlier reports targeted 2008-2010)
- Position (AIP obstacle list): 24.441611, 54.655194 (`242629.8N 0543918.7E`), [AIP AD 2.10](https://www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/html/eAIP/AD-2.OMAA-en-GB.html#OMAA-AD-2.10)
- Shape: Tall curved crescent / sail-like blade shaft with the visual control cab at the top, rising from a 5-storey rectangular technical base building
- Description: Designed by ADPi (Aeroports de Paris Ingenierie; design and supervision contract July 2006). Braced, curved steel tower structure over a reinforced-concrete 5-storey base with one basement; ~7,000 m2 floor area; 20 storeys (Terrell; Airport Technology). Its "swaying curves" were described as resembling the crescent moon, a dhow sail or a broadsword blade (TradeArabia 2006, page no longer online - text known from search-engine snippet). Stands in the midfield exactly between the two runways (~1.0 km from each centreline, computed from AIP coordinates), ~1.8 km along from the 13R threshold.
- Sources: [www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/htm...](https://www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/html/eAIP/AD-2.OMAA-en-GB.html#OMAA-AD-2.10), [www.airport-technology.com/features/feature-the-10-tallest-air-traf...](https://www.airport-technology.com/features/feature-the-10-tallest-air-traffic-control-towers-in-the-world-4142194/), [gulfnews.com/business/aviation/abu-dhabis-new-airport-tower-to-open...](https://gulfnews.com/business/aviation/abu-dhabis-new-airport-tower-to-open-this-year-1.588656), [terrellgroup.net/en/?p=19815](https://terrellgroup.net/en/?p=19815), [www.tradearabia.com/news/CONS_178507.html](https://www.tradearabia.com/news/CONS_178507.html), [www.openstreetmap.org/way/396942818](https://www.openstreetmap.org/way/396942818)

#### Old ATCC tower (near former Terminal 1)

- Height: n/a (not published)
- Opened: n/a
- Position (AIP obstacle list): 24.426028, 54.646833 (`242533.7N 0543848.6E`), [AIP AD 2.10](https://www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/html/eAIP/AD-2.OMAA-en-GB.html#OMAA-AD-2.10)
- Shape: n/a
- Description: Listed in AIP AD 2.10 as obstacle "OMAA AD 019 / OLD ATCC TOWER", top elevation 231 ft AMSL (height not published, roughly 45-50 m above ground - derived, approximate). OSM "Old Control Tower" footprint ~35 x 35 m.
- Sources: [www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/htm...](https://www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/html/eAIP/AD-2.OMAA-en-GB.html#OMAA-AD-2.10), [www.openstreetmap.org/way/313915237](https://www.openstreetmap.org/way/313915237)

### Cargo

Etihad Cargo hub. Existing cargo area lies on the south side next to the former terminals; a new East Midfield Cargo Terminal is under construction. 2024 cargo throughput 678,990 t (ADA via Wikipedia).

- Existing "Cargo Terminal" building near 24.4230 N, 54.6534 E: ~362 x 112 m, footprint ~39,500 m2 (OSM way 62271383, approximate)
- "Abu Dhabi Cargo Village" warehouse ~9,100 m2 footprint (OSM way 167460164, approximate)
- East Midfield Cargo Terminal (EMCT): ~90,000 m2, design capacity 1-1.5 million t/yr, ground broken December 2024 (RAQ Contracting), opening planned late 2027 (Stattimes / Construction Briefing; via search summaries)
- ACL W26 declaration: 9 additional stands for cargo operations; cargo-ops stand summary Code F 3, Code E 27 (30 total)
- Sources: [www.openstreetmap.org/way/62271383](https://www.openstreetmap.org/way/62271383), [www.stattimes.com/cargo-airports/abu-dhabi-airports-begins-east-mid...](https://www.stattimes.com/cargo-airports/abu-dhabi-airports-begins-east-midfield-cargo-terminal-construction-1353933), [www.acl-uk.org/wp-content/uploads/2026/04/W26-AUH-Capacity-Declarat...](https://www.acl-uk.org/wp-content/uploads/2026/04/W26-AUH-Capacity-Declaration-v1.0.pdf), [en.wikipedia.org/wiki/Zayed_International_Airport](https://en.wikipedia.org/wiki/Zayed_International_Airport)

### Reference photos (Wikimedia Commons, license verified on the file page)

- **Terminal A, exterior (used as the exterior image in the Wikipedia infobox); camera at 24.45176 N, 54.64163 E** - [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), by Vincent van Zeijst, 2024, aerial: no, 4032 x 3024 px. File page: [Commons](https://commons.wikimedia.org/wiki/File:Abu_Dhabi_(UAE),_Zayed_International_Airport,_Terminal_A_(03).jpg); original: [image](https://upload.wikimedia.org/wikipedia/commons/0/0c/Abu_Dhabi_%28UAE%29%2C_Zayed_International_Airport%2C_Terminal_A_%2803%29.jpg)
- **Terminal A (file page only says "Terminal A"; same camera position as (03), exterior/interior not stated)** - [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), by Vincent van Zeijst, 2024, aerial: no, 4032 x 3024 px. File page: [Commons](https://commons.wikimedia.org/wiki/File:Abu_Dhabi_(UAE),_Zayed_International_Airport,_Terminal_A_(01).jpg); original: [image](https://upload.wikimedia.org/wikipedia/commons/4/48/Abu_Dhabi_%28UAE%29%2C_Zayed_International_Airport%2C_Terminal_A_%2801%29.jpg)
- **Terminal A (file page only says "Terminal A"; exterior/interior not stated)** - [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), by Vincent van Zeijst, 2024, aerial: no, 4032 x 3024 px. File page: [Commons](https://commons.wikimedia.org/wiki/File:Abu_Dhabi_(UAE),_Zayed_International_Airport,_Terminal_A_(02).jpg); original: [image](https://upload.wikimedia.org/wikipedia/commons/2/22/Abu_Dhabi_%28UAE%29%2C_Zayed_International_Airport%2C_Terminal_A_%2802%29.jpg)
- **Terminal A (Commons category "Abu Dhabi International Airport Terminal A"; camera at 24.45193 N, 54.64091 E)** - [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), by Oleg Yunakov, 2025, aerial: no, 8064 x 6048 px. File page: [Commons](https://commons.wikimedia.org/wiki/File:Zayed_International_Airport_-_04.jpg); original: [image](https://upload.wikimedia.org/wikipedia/commons/d/df/Zayed_International_Airport_-_04.jpg)
- **Terminal A pier with jet bridge, airside** - [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), by Oleg Yunakov, 2025, aerial: no, 5712 x 4284 px. File page: [Commons](https://commons.wikimedia.org/wiki/File:Jet_bridge_at_Zayed_International_Airport_-_02.jpg); original: [image](https://upload.wikimedia.org/wikipedia/commons/7/7e/Jet_bridge_at_Zayed_International_Airport_-_02.jpg)
- **Terminal A pier facade and jet bridge seen from an aircraft at the gate** - [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), by Oleg Yunakov, 2025, aerial: no, 4284 x 5712 px. File page: [Commons](https://commons.wikimedia.org/wiki/File:Zayed_International_Airport%27s_Jet_bridge_seen_from_the_airplane_window.jpg); original: [image](https://upload.wikimedia.org/wikipedia/commons/6/6b/Zayed_International_Airport%27s_Jet_bridge_seen_from_the_airplane_window.jpg)
- **ATCC control tower (crescent/sail-shaped shaft)** - [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), by Oleg Yunakov, 2025, aerial: no, 3024 x 4032 px. File page: [Commons](https://commons.wikimedia.org/wiki/File:Zayed_International_Airport_Air_Traffic_Control_Tower.jpg); original: [image](https://upload.wikimedia.org/wikipedia/commons/c/c1/Zayed_International_Airport_Air_Traffic_Control_Tower.jpg)
- **ATCC control tower** - [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), by Oleg Yunakov, 2025, aerial: no, 3024 x 4032 px. File page: [Commons](https://commons.wikimedia.org/wiki/File:Air_Traffic_Control_Tower_of_Zayed_International_Airport.jpg); original: [image](https://upload.wikimedia.org/wikipedia/commons/3/3b/Air_Traffic_Control_Tower_of_Zayed_International_Airport.jpg)
- **ATCC control tower and base building** - [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), by Faruqdbd786, 2023, aerial: no, 2992 x 4000 px. File page: [Commons](https://commons.wikimedia.org/wiki/File:Air_Traffic_Control_Tower,_Al_Matar_-_Abu_Dhabi_-_United_Arab_Emirates.jpg); original: [image](https://upload.wikimedia.org/wikipedia/commons/1/12/Air_Traffic_Control_Tower%2C_Al_Matar_-_Abu_Dhabi_-_United_Arab_Emirates.jpg)
- **Whole airport from the ISS, March 2003 (historic: single runway, before 13L/31R and Terminal A)** - [Public domain (PD-USGov-NASA)](https://commons.wikimedia.org/wiki/Template:PD-USGov-NASA), by NASA (ISS Expedition 6 crew; author field not filled on file page), n/a, aerial: yes, 948 x 1064 px. File page: [Commons](https://commons.wikimedia.org/wiki/File:AbuDhabiIntlAirport.JPG); original: [image](https://upload.wikimedia.org/wikipedia/commons/8/88/AbuDhabiIntlAirport.JPG). Historic layout; useful only for context. Author field empty on the file page; PD as NASA ISS imagery.
- **Former Terminal 1 area (Commons category "Abu Dhabi International Airport Terminal 1"), 2016** - [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/), by Thomas Woodtli from Zürich, Switzerland, 2016, aerial: no, 4032 x 3024 px. File page: [Commons](https://commons.wikimedia.org/wiki/File:Abu_Dhabi_International_Airport_(30527362522).jpg); original: [image](https://upload.wikimedia.org/wikipedia/commons/f/f2/Abu_Dhabi_International_Airport_%2830527362522%29.jpg)
- **Apron at the former terminals, 2013 (Wikipedia caption "Airport apron")** - [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), by Ralf Roletschek, 2013, aerial: no, 4288 x 2848 px. File page: [Commons](https://commons.wikimedia.org/wiki/File:13-08-06-abu-dhabi-airport-30.jpg); original: [image](https://upload.wikimedia.org/wikipedia/commons/8/8c/13-08-06-abu-dhabi-airport-30.jpg)
- Gaps: No openly licensed aerial photo of Terminal A was found on Commons (searched the airport categories, "Aerial photographs of Abu Dhabi", ISS/Sentinel imagery). Unverified candidates (public domain, may show the airport at the edge of the frame): File:Abu Dhabi, the capital of the United Arab Emirates on the Persian Gulf coast (iss071e378611).jpg (ISS, 2024-07-23) and File:Iss069e071346.jpg (ISS, 2023-08-21). Exterior/interior status of Terminal A (01)/(02) is not stated on their file pages.

Layout diagrams (openly licensed, not photos):

- Terminal A layout diagram (SVG) - [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), by Merely another passerby, 2023. File page: [Commons](https://commons.wikimedia.org/wiki/File:AUH_Terminal_A.svg); original: [file](https://upload.wikimedia.org/wikipedia/commons/b/b1/AUH_Terminal_A.svg)
- Airport schematic 2024 (SVG) - [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), by Nord794ub, 2024. File page: [Commons](https://commons.wikimedia.org/wiki/File:Abudhabi2024schema.svg); original: [file](https://upload.wikimedia.org/wikipedia/commons/2/28/Abudhabi2024schema.svg)

### Sources

- [UAE GCAA eAIP AD 2.OMAA (AIRAC AMDT 12/2026 package, eff. 26 NOV 2026)](https://www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/html/eAIP/AD-2.OMAA-en-GB.html) (accessed 2026-10-26): ARP, elevation, MAG VAR, runways, thresholds, declared distances, aprons, obstacle heights (AD 2.2, 2.8, 2.10, 2.12, 2.13)
- [UAE GCAA eAIP AD 2.OMAA (AIRAC AMDT 09/2026 package, in force on 2026-10-26)](https://www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P08/html/eAIP/AD-2.OMAA-en-GB.html) (accessed 2026-10-26): cross-check of AD 2.2/2.12/2.13
- [UAE GCAA eAIP index (package list and effective dates)](https://www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIP.aspx) (accessed 2026-10-26): AIRAC cycle identification
- [Wikipedia: Zayed International Airport](https://en.wikipedia.org/wiki/Zayed_International_Airport) (accessed 2026-10-26): renaming (9 Feb 2024), history, former terminals, opening of 13L/31R (Oct 2008), Terminal A opening sequence, alternative elevation/runway lengths
- [KPF project page: Zayed International Airport](https://www.kpf.com/project/zayed-international-airport) (accessed 2026-10-26): Terminal A area, capacity, X plan, roof concept, 50 m hall and facade, canted pier glazing, frit
- [KPF news: Opening announced for Terminal A (2023-08-31)](https://www.kpf.com/news/opening-announced-for-abu-dhabi-international-airport-terminal-a) (accessed 2026-10-26): 45 mppa, 11,000 pax/h, 79 aircraft
- [KPF news: Video footage of Midfield Terminal](https://www.kpf.com/news/video-footage-of-midfield-terminal-shows-kpf-projects-size-and-complexity) (accessed 2026-10-26): 7.9 million sq ft, X-shape, plateau, visibility
- [Hill International project page: Midfield Terminal Complex](https://www.hillintl.com/project/abu-dhabi-international-airport-midfield-terminal-complex/) (accessed 2026-10-26): arches up to 180 m / 700 t, 319 m roof span, 52 m ceiling, glazing and aluminium cladding areas, 65 aircraft, delivery Nov 2023
- [AviationWeek (2016-01-06): Steel structure of the MTB roof complete](https://aviationweek.com/air-transport/airports-networks/steel-structure-midfield-terminal-building-roof-complete) (accessed 2026-10-26): 18 arches, largest 180 m wide x 52 m high, 319 m roof span, four piers
- [ME Construction News: Steel roof structure completed at Midfield Terminal](https://meconstructionnews.com/14067/steel-roof-structure-completed-at-midfield-terminal-in-abu-dhabi) (accessed 2026-10-26): same roof figures (cross-check)
- [Dezeen (2024-02-14): KPF tops Abu Dhabi airport with undulating roof informed by sand dunes](https://www.dezeen.com/?p=2033239) (accessed 2026-10-26): roof concept, 180 m single roof span, flanking four-storey buildings, Sana Al Nour dimensions
- [Gulf News (2023-08-31): Terminal A set to begin operations in November 2023](https://gulfnews.com/business/aviation/abu-dhabi-airports-terminal-a-set-to-begin-operations-in-november-2023-1.97835736) (accessed 2026-10-26): 742,000 m2 built-up area, 45 mppa, 11,000 pax/h, 79 aircraft
- [ACL: Zayed International Airport (AUH) W26 Capacity Declaration v1.0 (2026-04-30)](https://www.acl-uk.org/wp-content/uploads/2026/04/W26-AUH-Capacity-Declaration-v1.0.pdf) (accessed 2026-10-26): contact/remote gates and stands, cargo stands
- [Airport Technology: The 10 tallest ATC towers](https://www.airport-technology.com/features/feature-the-10-tallest-air-traffic-control-towers-in-the-world-4142194/) (accessed 2026-10-26): AUH tower 109 m, 2011, 20 storeys
- [Gulf News (c.2010): Abu Dhabi's new airport tower to open this year](https://gulfnews.com/business/aviation/abu-dhabis-new-airport-tower-to-open-this-year-1.588656) (accessed 2026-10-26): 109 m, 20 storeys, between the runways
- [Terrell Group: Control Tower Abu Dhabi Airport](https://terrellgroup.net/en/?p=19815) (accessed 2026-10-26): ADPi architect, 100 m braced curved steel tower, 5-storey RC base, 7,000 m2, 2011
- [TradeArabia (2006, page no longer available; via search snippet)](https://www.tradearabia.com/news/CONS_178507.html) (accessed 2026-10-26): 110 m design height, crescent/dhow-sail description
- [STAT Times: Abu Dhabi Airports begins East Midfield Cargo Terminal construction (via search summary)](https://www.stattimes.com/cargo-airports/abu-dhabi-airports-begins-east-midfield-cargo-terminal-construction-1353933) (accessed 2026-10-26): EMCT size, capacity and schedule
- [OpenStreetMap relation 20328079 (Terminal A) and nearby features (ODbL)](https://www.openstreetmap.org/relation/20328079) (accessed 2026-10-26): approximate footprint extents, height tags, tower position cross-check
- Commons file pages for each photo are listed in the photo section above.

## OMDB / DXB: Dubai International Airport

- AIP name: DUBAI / INTERNATIONAL; city: Dubai
- ARP: **25.2527778, 55.3644444** (AIP `251510N 0552152E`; site: On CL RWY 12R/30L, at the displaced threshold of RWY 12R). Source: [GCAA eAIP AD 2.2](https://www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/html/eAIP/AD-2.OMDB-en-GB.html#OMDB-AD-2.2)
  - Cross-check: 25°15′10″N 055°21′52″E (25.25278, 55.36444) (same as AIP), [Wikipedia](https://en.wikipedia.org/wiki/Dubai_International_Airport)
- Aerodrome elevation: **62 ft / 18.9 m AMSL**; reference temperature 41 C; geoid undulation -112 ft. Source: [GCAA eAIP AD 2.2](https://www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/html/eAIP/AD-2.OMDB-en-GB.html#OMDB-AD-2.2)
  - Other value: 62 ft / 19 m (agrees), [Wikipedia](https://en.wikipedia.org/wiki/Dubai_International_Airport)
- Magnetic variation: **2.0 deg E (2026)**, annual change 0.0 deg E. Source: [GCAA eAIP AD 2.2](https://www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/html/eAIP/AD-2.OMDB-en-GB.html#OMDB-AD-2.2) Note: AIRAC AMDT 12/2026 (effective 26 NOV 2026) changes this entry to 2 deg E (2026) / 0.00 deg; the edition in force on 2026-10-26 (AMDT 09/2026) reads 2 deg E (2020) / 0.05 deg E.

### Runways

| Runway | Length x width (m) | True bearing, AIP (deg) | True bearing, computed (deg) | Mag. bearing (deg) | Surface / PCR | Displaced THR (m) | Declared distances TORA / TODA / ASDA / LDA (m) |
|---|---|---|---|---|---|---|---|
| 12R/30L | 4447 x 60 | 121/301 | 121.36/301.38 | 119/299 | asphalt / 850/F/A/W/T | 12R: 715, 30L: 132 | 12R: 4315 / 4375 / 4504 / 3600<br>30L: 4447 / 4507 / 4682 / 4315 |
| 12L/30R | 4351 x 60 | 121/301 | 121.36/301.38 | 119/299 | asphalt / 850/F/A/W/T | 12L: 450, 30R: 300 | 12L: 4050 / 4110 / 4176 / 3600<br>30R: 4300 / 4360 / 4361 / 4000 |

Thresholds (landing thresholds; displaced where noted):

| THR | Lat | Lon | AIP DMS | Elevation | Displaced (m) |
|---|---|---|---|---|---|
| 12R | 25.2528361 | 55.3643750 | `251510.21N 0552151.75E` | 10.9 ft / 3.32 m | 715 |
| 30L | 25.2359194 | 55.3948806 | `251409.31N 0552341.57E` | 59.8 ft / 18.23 m | 132 |
| 12L | 25.2646278 | 55.3504222 | `251552.66N 0552101.52E` | 11.7 ft / 3.57 m | 450 |
| 30R | 25.2477083 | 55.3809306 | `251451.75N 0552251.35E` | 32.6 ft / 9.94 m | 300 |

- 12R/30L pavement ends: NW (12R start): 25.2561944, 55.3583111 (`251522.30N 0552129.92E`); SE (30L start): 25.2352944, 55.3960028 (`251407.06N 0552345.61E`)
- 12R/30L geodesic length from AIP coordinates: 4447.5 m. Notes: Southern runway. Displaced thresholds: 12R by 715 m, 30L by 132 m. ARP is at the 12R displaced threshold. Resurfaced and relit during a 45-day closure 16 Apr - 30 May 2019. Designators unchanged: no renumbering found (current AIP, Wikipedia, ACL and AIN 2022 all use 12R/30L and 12L/30R). 180-degree turns not permitted for aircraft larger than A320.
  Sources: [www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/htm...](https://www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/html/eAIP/AD-2.OMDB-en-GB.html#OMDB-AD-2.12), [www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/htm...](https://www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/html/eAIP/AD-2.OMDB-en-GB.html#OMDB-AD-2.13), [en.wikipedia.org/wiki/Dubai_International_Airport](https://en.wikipedia.org/wiki/Dubai_International_Airport)
- 12L/30R pavement ends: NW (12L start): 25.2667444, 55.3466000 (`251600.28N 0552047.76E`); SE (30R start): 25.2462972, 55.3834750 (`251446.67N 0552300.51E`)
- 12L/30R geodesic length from AIP coordinates: 4350.9 m. Notes: Northern runway. Displaced thresholds: 12L by 450 m, 30R by 300 m. Centreline separation ~384 m (computed from AIP coordinates; Wikipedia 385 m). Wikipedia body text still says 4,000 x 60 m (AIN 2022: 13,120 ft) - the AIP pavement length is 4,351 m (LDA 3,600/4,000 m). Closed 9 May - 22 June 2022 for the Northern Runway Rehabilitation (resurfacing, strip strengthening, AGL replacement). Designators unchanged (no renumbering found).
  Sources: [www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/htm...](https://www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/html/eAIP/AD-2.OMDB-en-GB.html#OMDB-AD-2.12), [www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/htm...](https://www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/html/eAIP/AD-2.OMDB-en-GB.html#OMDB-AD-2.13), [www.acl-uk.org/dubai-northern-runway-rehabilitation/](https://www.acl-uk.org/dubai-northern-runway-rehabilitation/), [en.wikipedia.org/wiki/Dubai_International_Airport](https://en.wikipedia.org/wiki/Dubai_International_Airport)

- Stands (ACL S26): 182 total (45 north side, 137 south side); by ICAO code: Code C 38, Code D 1, Code E 88, Code F 55; declared contact stands: Concourse A 17, Concourse B 20, Concourse C 20, Concourse D 18. ACL S26 slot-coordination declaration (delivered 01/10/2025, "PUBLIC - OPEN DATA"). Declared stands can be fewer than physical gates (e.g. Concourse A has 20 A380 contact gates). Source: [www.acl-uk.org/wp-content/uploads/2025/10/S26-DXB-Capacity-Declarat...](https://www.acl-uk.org/wp-content/uploads/2025/10/S26-DXB-Capacity-Declaration.pdf)

### Terminals and concourses

#### Terminal 1

- Type: terminal
- Opened: 1971 (original building, 15 May 1971); refurbished 2013-2015 and again later
- Floor area: 122,930 m2 Other values: 520,000 m2 (Wikipedia, probably includes Concourses C/D - not used).
- Gates: n/a (Gates are in Concourse D (and formerly Concourse C); T1 has check-in rows 1-5 + Area 6 (42 counters each in rows 1-4).)
- Capacity: 20 mppa ("more than 20 million" (Dubai Airports T1 fact file); Wikipedia says 45 mppa.)
- Architect: n/a
- Plan shape: Rectangular landside processor, 502 x 125 m, 3 floors (excluding roof); connected airside to Concourse D by an elevated people mover and historically to Concourse C (Sheikh Rashid Terminal).
- Dimensions (m): length 502, width 125, OSM min. bounding rectangle (approx.): 651 x 127 m, footprint ~65,200 m2 (OSM way 98425196; outline likely includes link structures)
- Features: The original 1971 building featured ogee arches that are still present (Wikipedia). Apron floor area 54,458 m2, departure floor 40,207 m2 (fact file).
- Sources: [media.dubaiairports.ae/terminal-1/](https://media.dubaiairports.ae/terminal-1/), [media.dubaiairports.ae/download/cd073884-a40d-4035-a939-e21451137b7...](https://media.dubaiairports.ae/download/cd073884-a40d-4035-a939-e21451137b70/dxbt1factfile.pdf), [en.wikipedia.org/wiki/Dubai_International_Airport](https://en.wikipedia.org/wiki/Dubai_International_Airport)

#### Concourse D (serves Terminal 1)

- Type: concourse
- Opened: 2016-02-24
- Floor area: 150,000 m2 (Built-up area 150,000 m2; footprint 65,000 m2.)
- Gates: 32 (32 gates incl. 4 Code F: 21 contact + 11 remote (fact file); second fact-file table lists Code E 12, Code C 1, Code F 4 gates with lounges and 11 remote stands; ACL S26 declares 18 contact stands (6 C, 11 E, 1 F).)
- Capacity: 18 mppa (18 mppa (2023 fact file); 15 mppa at opening (Wikipedia).)
- Architect: n/a
- Plan shape: Linear pier/concourse built around a central atrium, open-gate concept; linked to T1 by a 2-minute elevated rail people mover (5 cars, 300 pax).
- Dimensions (m): length 700, width 144, height 27, OSM min. bounding rectangle (approx.): 699 x 161 m, footprint ~57,000 m2 (OSM way 302538629)
- Height (m): 27
- Features: 4 floors incl. service floor; 450 m2 of solar panels; cost AED 3.35 bn incl. APM.
- Sources: [media.dubaiairports.ae/download/cb6d4011-5496-4930-aaf6-352d392cd04...](https://media.dubaiairports.ae/download/cb6d4011-5496-4930-aaf6-352d392cd049/concoursedfactfile.pdf), [www.acl-uk.org/wp-content/uploads/2025/10/S26-DXB-Capacity-Declarat...](https://www.acl-uk.org/wp-content/uploads/2025/10/S26-DXB-Capacity-Declaration.pdf), [en.wikipedia.org/wiki/Dubai_International_Airport](https://en.wikipedia.org/wiki/Dubai_International_Airport)

#### Concourse C (Sheikh Rashid Terminal; part of Terminal 3 complex since 2016)

- Type: concourse
- Opened: 2000 (15 April 2000 per Wikipedia)
- Floor area: 145,290 m2
- Gates: 27 (27 gates; 22 contact stands with passenger loading bridges; 21 remote stands (fact file). ACL S26 declares 20 contact stands (8 Code E, 12 Code F). Wikipedia: 50 gates incl. 28 air bridges (older).)
- Capacity: n/a
- Architect: n/a
- Plan shape: Long straight concourse ~800 m (780.8 x 66.8 m), joined to Concourse B at the control-tower structure; 6 floors incl. basement.
- Dimensions (m): length 780.8, width 66.8, OSM min. bounding rectangle (approx.): 792 x 72 m, footprint ~52,200 m2 (OSM way 10315513)
- Features: Contains a hotel; departure floor 47,447 m2, apron floor 46,785 m2 (fact file).
- Sources: [media.dubaiairports.ae/download/3e609824-fd5c-48b5-bcfe-1bf1f8f3611...](https://media.dubaiairports.ae/download/3e609824-fd5c-48b5-bcfe-1bf1f8f36116/concoursecfactfile.pdf), [www.acl-uk.org/wp-content/uploads/2025/10/S26-DXB-Capacity-Declarat...](https://www.acl-uk.org/wp-content/uploads/2025/10/S26-DXB-Capacity-Declaration.pdf), [en.wikipedia.org/wiki/Dubai_International_Airport](https://en.wikipedia.org/wiki/Dubai_International_Airport)

#### Terminal 2

- Type: terminal
- Opened: 1998-05-01
- Floor area: 12,500 m2 (Departures 10,000 m2 + boarding 2,500 m2 built-up (fact file); Wikipedia 47,000 m2 (probably whole complex) - treat as approximate.)
- Gates: 12 (12 bus gates (F1-F12), 43 remote stands, no jet bridges (fact file; Wikipedia).)
- Capacity: 12 mppa ("over 12 million" pax/yr (fact file); 2,200 arr + 1,700 dep pax/hour.)
- Architect: n/a
- Plan shape: Low single-storey terminal on the north side of the airfield (fact file: north of Terminal 1, access from Al Twar Road and Rashidiya; ACL lists its aprons Echo/Quebec as North side), with the remote stands behind it.
- Dimensions (m): OSM min. bounding rectangle (approx.): 708 x 97 m, footprint ~59,100 m2 (OSM way 98425234; outline probably includes the boarding/remote-gate wing)
- Features: Home of flydubai since 1 June 2009. Executive Flight Terminal (business aviation) sits close by.
- Sources: [media.dubaiairports.ae/terminal-2/](https://media.dubaiairports.ae/terminal-2/), [media.dubaiairports.ae/download/0bf76bf7-a0ab-41a3-a0a1-54fda21feac...](https://media.dubaiairports.ae/download/0bf76bf7-a0ab-41a3-a0a1-54fda21feacb/dxbt2factfile.pdf), [en.wikipedia.org/wiki/Dubai_International_Airport](https://en.wikipedia.org/wiki/Dubai_International_Airport)

#### Terminal 3 (landside building)

- Type: terminal
- Opened: 2008-10-14
- Floor area: 515,000 m2 Other values: 1,713,000 m2 (Wikipedia - whole T3 complex incl. concourses).
- Gates: n/a (Gates are in Concourses A, B and C.)
- Capacity: n/a (T3 together with Concourse B added 43 mppa in 2008 (airport total to 60 mppa); Concourse A later added 15 mppa (to 75).)
- Architect: Aeroports de Paris Ingenierie (ADPi) per Wikipedia (Dubai International Terminal 3); contractors Al Habtoor, Murray & Roberts, Takenaka
- Plan shape: Landside processor largely BELOW the apron: departure and arrival halls ~10 m beneath apron level, directly connected underground to Concourse B; 6 floors.
- Facade: Steel-frame roof with glass facades (Wikipedia).
- Features: 33,000 t structural steel; 3-floor 177,500 m2 car park with 1,889 spaces; Dubai Metro station (Sept 2009). US$4.5 bn incl. Concourse B. OSM maps only a ~299 x 25 m above-ground strip as "Terminal 3" (way 98425182) - most of the building is below apron level.
- Sources: [media.dubaiairports.ae/terminal-3/](https://media.dubaiairports.ae/terminal-3/), [media.dubaiairports.ae/download/012c0143-f4f6-4e80-9b5c-f2dc7ad0d95...](https://media.dubaiairports.ae/download/012c0143-f4f6-4e80-9b5c-f2dc7ad0d95d/dxbt3factfile.pdf), [en.wikipedia.org/wiki/Dubai_International_Terminal_3](https://en.wikipedia.org/wiki/Dubai_International_Terminal_3)

#### Concourse B (Terminal 3)

- Type: concourse
- Opened: 2008-10-14
- Floor area: 670,000 m2 Other values: 675,000 m2 (Wikipedia).
- Gates: 31 (25 contact stands + 6 remote gates (incl. 5 A380 gates), 59 passenger loading bridges (fact file); ACL S26 declares 20 contact stands (11 E, 9 F); Wikipedia: gates B1-B32, 26 with air bridges.)
- Capacity: n/a
- Architect: ADPi (T3 complex, per Wikipedia)
- Plan shape: Very long, straight, symmetric airside concourse lying parallel to the runways, widest at the middle and tapering to both ends; joined to Concourse C at the control-tower structure and to T3 underground.
- Roof: Vaulted structural-steel roof along the concourse (BG&E: design of the "structural steel vaulted roof of the main concourse"); ~70,000 m2 standing-seam metal roofing (Al Abbar, via search summary).
- Dimensions (m): length 924, width at midpoint 90.8, width at ends 56, height 39.5, OSM min. bounding rectangle (approx.): 920 x 101 m, footprint ~80,100 m2 (OSM way 87185819)
- Height (m): 39.5
- Facade: Glazed long facades under the vaulted metal roof (glazing and other cladding supplied by Al Abbar, via search summary); check photos for mullion pattern.
- Colours: Not documented: light metallic roof and glass - see photos.
- Features: 10 floors (4 basement + ground + 5). Hotel and lounges on upper levels; four SkyTrain elevators. Wikipedia instead gives 945 x 90.8 x 49.5 m - the official fact file values are used.
- Sources: [media.dubaiairports.ae/download/12fb6018-bd7f-416a-a79b-eff49c20d62...](https://media.dubaiairports.ae/download/12fb6018-bd7f-416a-a79b-eff49c20d622/concoursebfactfile.pdf), [bgeeng.com/projects/dubai-international-airport-terminal-expansion/](https://bgeeng.com/projects/dubai-international-airport-terminal-expansion/), [www.alabbargroup.com/projects/dubai-international-airport/](https://www.alabbargroup.com/projects/dubai-international-airport/), [www.acl-uk.org/wp-content/uploads/2025/10/S26-DXB-Capacity-Declarat...](https://www.acl-uk.org/wp-content/uploads/2025/10/S26-DXB-Capacity-Declaration.pdf), [en.wikipedia.org/wiki/Dubai_International_Airport](https://en.wikipedia.org/wiki/Dubai_International_Airport)

#### Concourse A (Terminal 3)

- Type: concourse
- Opened: 2013-01-02
- Floor area: 528,000 m2 Other values: 540,000 m2 (Wikipedia).
- Gates: 22 (20 contact gates all A380-capable + 2 Code E gates, plus 7 remote gates/lounges (13 remote stands in 2012 sheet) (fact files); ACL S26 declares 17 Code F contact stands.)
- Capacity: 19 mppa
- Architect: Not confirmed (T3 complex credited to ADPi on Wikipedia)
- Plan shape: Free-standing midfield satellite east of Concourse B, linked by an underground automated people mover and service tunnels; "similar to Concourse B in appearance but with a smaller footprint".
- Roof: Long vaulted/arched metal roof in the same style as Concourse B (official fact file: similar appearance).
- Dimensions (m): length 645, width 90.8, height 42, OSM min. bounding rectangle (approx.): 655 x 104 m, footprint ~65,300 m2 (OSM way 231888210) - confirms ~645 m, not 924 m
- Height (m): 42
- Facade: Glazed long facades under the arched roof (as Concourse B).
- Colours: Not documented - see photos.
- Features: World's first purpose-built A380 concourse with multi-level boarding direct from First/Business lounges; central atrium with large "SkyTrain" elevators; 4- and 5-star hotels; 11 floors (2012 sheet) / 16 floors (later fact file). Wikipedia gives 924 x 91 x 40 m, which matches Concourse B and looks transposed - the official 645 x 90.8 x 42 m is used.
- Sources: [media.dubaiairports.ae/download/2960f806-2a8c-4af9-8aa5-fd61105c5c6...](https://media.dubaiairports.ae/download/2960f806-2a8c-4af9-8aa5-fd61105c5c60/concourseafactfile.pdf), [web.archive.org/web/20121230055256/www.dubaiairport.com/en/media-ce...](https://web.archive.org/web/20121230055256/http://www.dubaiairport.com/en/media-centre/facts-figures/pages/factsheets-reports-statistics.aspx?id=10), [www.acl-uk.org/wp-content/uploads/2025/10/S26-DXB-Capacity-Declarat...](https://www.acl-uk.org/wp-content/uploads/2025/10/S26-DXB-Capacity-Declaration.pdf), [en.wikipedia.org/wiki/Dubai_International_Airport](https://en.wikipedia.org/wiki/Dubai_International_Airport)

### Control towers

#### DXB air traffic control tower (Dubai Air Navigation Services)

- Height: 89 m (other values: 87 m (Wikipedia, citing Bechtel); AIP AD 2.10 obstacle "OMDB AD 18962 / ATC_AERIAL" (type CONTROL_TOWER): height 281 ft (85.6 m), top elevation 289 ft AMSL)
- Opened: 2000 (in operation since the 2000 expansion that opened Sheikh Rashid Terminal / Concourse C)
- Position (AIP obstacle list): 25.250667, 55.357611 (`251502.4N 0552127.4E`), [AIP AD 2.10](https://www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/html/eAIP/AD-2.OMDB-en-GB.html#OMDB-AD-2.10)
- Shape: Buttressed central column with arched "wings", likened to a futuristic bird sculpture, topped by a multilevel control cab
- Description: Stands at the junction of Concourses B and C (Wikipedia: the walkway link between Concourse B and Sheikh Rashid Terminal/Concourse C is "at the control tower structure"), ~560 m south-west of the 12R/30L centreline near the western end of the runway (computed from AIP coordinates); OSM maps a ~120 x 95 m terminal block around this junction (way 264966382). In June 2026 Dubai Airports unveiled a new tower design carrying the UAE flag (colours red, green, white, black); the exact paint pattern is not described in the sources - check current photos before texturing.
- Sources: [www.zawya.com/en/business/aviation/dubai-airports-unveils-new-desig...](https://www.zawya.com/en/business/aviation/dubai-airports-unveils-new-design-of-its-air-traffic-control-tower-at-dxb-tj2e58wf), [moodiedavittreport.com/images-of-the-day-dubai-international-airpor...](https://moodiedavittreport.com/images-of-the-day-dubai-international-airport-proudly-flies-uae-flag-with-air-control-tower-makeover/), [en.wikipedia.org/wiki/Dubai_International_Airport](https://en.wikipedia.org/wiki/Dubai_International_Airport), [www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/htm...](https://www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/html/eAIP/AD-2.OMDB-en-GB.html#OMDB-AD-2.10)

### Cargo

Dubai Airports cargo facilities (operated mainly by dnata) in the cargo village area; total DXB cargo capacity 3.3 million t/yr; 2024 throughput 2.2 million t. Freighter operations partly moved to DWC.

- Cargo Mega Terminal (CMT): opened 2008, US$200 m, +1.2 million t (to 2.5 million t total); 57 docks (21 general, 10 truck, 12 perishables, 14 pharma)
- Original cargo facility (1991): 35,000 m2, 150,000 t/yr
- Dubai Flower Centre: first phase 2004 (US$50 m), ~100,000 m2 planned, kept at 2-4 C; Freight Gates FG2-FG5 + DFC combined 720,000 t/yr
- Air Cargo Terminal (ACT): 56 truck docks + 7 sea-air docks; Agents Building with 65 freight forwarders
- FedEx (14,000 t) and DHL (75,000 t) facilities on the north side
- Dubai Vaccine Centre: 140,000 t/yr, 2-8 C
- Sources: [media.dubaiairports.ae/cargo--logistics/](https://media.dubaiairports.ae/cargo--logistics/), [en.wikipedia.org/wiki/Dubai_International_Airport](https://en.wikipedia.org/wiki/Dubai_International_Airport)

### Reference photos (Wikimedia Commons, license verified on the file page)

- **Whole airport and Dubai Creek seen from the ISS (oblique orbital view)** - [Public domain (PD-USGov-NASA)](https://commons.wikimedia.org/wiki/Template:PD-USGov-NASA), by NASA, 2021, aerial: yes, 5568 x 3712 px. File page: [Commons](https://commons.wikimedia.org/wiki/File:ISS-65_Dubai_International_Airport_and_Dubai_Creek.jpg); original: [image](https://upload.wikimedia.org/wikipedia/commons/9/94/ISS-65_Dubai_International_Airport_and_Dubai_Creek.jpg)
- **Aerial overview of DXB** - [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/), by Umair Shaikh, 2013, aerial: yes, 4309 x 2037 px. File page: [Commons](https://commons.wikimedia.org/wiki/File:Dubai_Airport_overview.jpg); original: [image](https://upload.wikimedia.org/wikipedia/commons/8/86/Dubai_Airport_overview.jpg)
- **Overview of DXB taken shortly after departure** - [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), by Pulkit Sangal, 2010, aerial: yes, 1600 x 1100 px. File page: [Commons](https://commons.wikimedia.org/wiki/File:DXB_Overview.jpg); original: [image](https://upload.wikimedia.org/wikipedia/commons/3/33/DXB_Overview.jpg)
- **DXB from an Emirates flight (camera near 25.2591 N, 55.3564 E)** - [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), by Psubhashish, 2016, aerial: yes, 5400 x 3122 px. File page: [Commons](https://commons.wikimedia.org/wiki/File:View_of_Dubai_International_airport_from_an_Emirates_flight.jpg); original: [image](https://upload.wikimedia.org/wikipedia/commons/1/14/View_of_Dubai_International_airport_from_an_Emirates_flight.jpg)
- **DubaiSat-1 satellite image of DXB (vertical)** - [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/), by Emirates Institution for Advanced Science and Technology, 2010, aerial: yes, 2755 x 2754 px. File page: [Commons](https://commons.wikimedia.org/wiki/File:Dubai_International_Airport1.jpg); original: [image](https://upload.wikimedia.org/wikipedia/commons/1/18/Dubai_International_Airport1.jpg)
- **Cargo terminal stands and Terminal 2, just after take-off from runway 30L** - [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/), by Kurush Pawar from Dubai, United Arab Emirates, 2014, aerial: yes, 3690 x 2459 px. File page: [Commons](https://commons.wikimedia.org/wiki/File:Cargo_Terminal_and_T2,_DXB.jpg); original: [image](https://upload.wikimedia.org/wikipedia/commons/4/48/Cargo_Terminal_and_T2%2C_DXB.jpg)
- **Terminal 2 remote stands from a departing aircraft** - [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/), by Kurush Pawar from Dubai, United Arab Emirates, 2012, aerial: yes, 3212 x 2264 px. File page: [Commons](https://commons.wikimedia.org/wiki/File:Overlooking_Terminal_2%27s_parking_slots_(7907337786).jpg); original: [image](https://upload.wikimedia.org/wikipedia/commons/0/09/Overlooking_Terminal_2%27s_parking_slots_%287907337786%29.jpg)
- **Part of Terminal 2 seen from a departing aircraft (Oct 2024)** - [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), by Andy Mabbett, 2024, aerial: yes, 3872 x 2592 px. File page: [Commons](https://commons.wikimedia.org/wiki/File:Dubai_International_Airport_-_2024-10-24_-_Andy_Mabbett_-_65.jpg); original: [image](https://upload.wikimedia.org/wikipedia/commons/d/d7/Dubai_International_Airport_-_2024-10-24_-_Andy_Mabbett_-_65.jpg)
- **Terminal 1 landside exterior** - [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), by Vitorabdala, 2021, aerial: no, 4128 x 3096 px. File page: [Commons](https://commons.wikimedia.org/wiki/File:DXB_T1.jpg); original: [image](https://upload.wikimedia.org/wikipedia/commons/a/af/DXB_T1.jpg)
- **Terminal 3 seen from the Terminal 1 building** - [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/), by Ahmedn97, 2012, aerial: no, 1792 x 1344 px. File page: [Commons](https://commons.wikimedia.org/wiki/File:Emirates_Terminal_3.jpg); original: [image](https://upload.wikimedia.org/wikipedia/commons/2/2f/Emirates_Terminal_3.jpg)
- **Terminal 3 building exterior** - [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/), by Kiwi05, 2011, aerial: no, 3008 x 2000 px. File page: [Commons](https://commons.wikimedia.org/wiki/File:Geb%C3%A4ude_Terminal_3.JPG); original: [image](https://upload.wikimedia.org/wikipedia/commons/b/b3/Geb%C3%A4ude_Terminal_3.JPG)
- **Terminal 2 exterior** - [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), by giggel, 2015, aerial: no, 3279 x 2737 px. File page: [Commons](https://commons.wikimedia.org/wiki/File:Dubai_-_Airport_International_-Terminal_2_-_%D8%AF%D8%A8%D9%8A_-_%D8%A7%D9%84%D9%85%D8%B7%D8%A7%D8%B1_%D8%A7%D9%84%D8%AF%D9%88%D9%84%D9%8A_-Terminal_2_-_panoramio.jpg); original: [image](https://upload.wikimedia.org/wikipedia/commons/7/72/Dubai_-_Airport_International_-Terminal_2_-_%D8%AF%D8%A8%D9%8A_-_%D8%A7%D9%84%D9%85%D8%B7%D8%A7%D8%B1_%D8%A7%D9%84%D8%AF%D9%88%D9%84%D9%8A_-Terminal_2_-_panoramio.jpg)
- Gaps: No openly licensed close-up of the control tower or of Concourse A/B exteriors was found (the Airliners.net aerial shots of Concourses B/C on Commons are GFDL-only and were excluded). Extra candidate: File:Earth Observations taken during Expedition 69 (iss069e005018).jpg (ISS night view with DXB at centre, public domain, 2023).

Layout diagrams (openly licensed, not photos):

- Airport layout diagram (SVG, October 2016 - may predate later changes) - [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), by CellarDoor85, 2016. File page: [Commons](https://commons.wikimedia.org/wiki/File:OMDB_Layout.svg); original: [file](https://upload.wikimedia.org/wikipedia/commons/d/dc/OMDB_Layout.svg)

### Sources

- [UAE GCAA eAIP AD 2.OMDB (AIRAC AMDT 12/2026 package, eff. 26 NOV 2026)](https://www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/html/eAIP/AD-2.OMDB-en-GB.html) (accessed 2026-10-26): ARP, elevation, MAG VAR, runways, thresholds, declared distances, aprons, obstacle heights (AD 2.2, 2.8, 2.10, 2.12, 2.13)
- [UAE GCAA eAIP AD 2.OMDB (AIRAC AMDT 09/2026 package, in force on 2026-10-26)](https://www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P08/html/eAIP/AD-2.OMDB-en-GB.html) (accessed 2026-10-26): cross-check of AD 2.2/2.12/2.13
- [UAE GCAA eAIP index (package list and effective dates)](https://www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIP.aspx) (accessed 2026-10-26): AIRAC cycle identification
- [Wikipedia: Dubai International Airport](https://en.wikipedia.org/wiki/Dubai_International_Airport) (accessed 2026-10-26): history, runway works 2014/2019, terminal descriptions, tower 87 m, cargo history
- [Wikipedia: Dubai International Terminal 3](https://en.wikipedia.org/wiki/Dubai_International_Terminal_3) (accessed 2026-10-26): architect ADPi, contractors
- [Dubai Airports media: Terminal 3 fact file page](https://media.dubaiairports.ae/terminal-3/) (accessed 2026-10-26): T3 area, floors, cost, opening; links to fact files
- [Dubai Airports: DXB Terminal 3 fact file (PDF)](https://media.dubaiairports.ae/download/012c0143-f4f6-4e80-9b5c-f2dc7ad0d95d/dxbt3factfile.pdf) (accessed 2026-10-26): T3 515,000 m2, 6 floors, structural steel, car park
- [Dubai Airports: Concourse A fact file (PDF)](https://media.dubaiairports.ae/download/2960f806-2a8c-4af9-8aa5-fd61105c5c60/concourseafactfile.pdf) (accessed 2026-10-26): Concourse A 645 x 90.8 x 42 m, 528,000 m2, 20 A380 gates, 19 mppa
- [Dubai Airports: Concourse B fact file (PDF)](https://media.dubaiairports.ae/download/12fb6018-bd7f-416a-a79b-eff49c20d622/concoursebfactfile.pdf) (accessed 2026-10-26): Concourse B 924 x 90.8 (56 at ends) x 39.5 m, 670,000 m2, 25 contact + 6 remote, 10 floors
- [Dubai Airports: Concourse C fact file (PDF)](https://media.dubaiairports.ae/download/3e609824-fd5c-48b5-bcfe-1bf1f8f36116/concoursecfactfile.pdf) (accessed 2026-10-26): Concourse C 780.8 x 66.8 m, 145,290 m2, 27 gates
- [Dubai Airports media: Terminal 1 fact file page](https://media.dubaiairports.ae/terminal-1/) (accessed 2026-10-26): T1 122,930 m2, 502 x 125 m, 3 floors, >20 mppa
- [Dubai Airports: DXB Terminal 1 fact file (PDF)](https://media.dubaiairports.ae/download/cd073884-a40d-4035-a939-e21451137b70/dxbt1factfile.pdf) (accessed 2026-10-26): same (PDF)
- [Dubai Airports: Concourse D fact file (PDF, 2023)](https://media.dubaiairports.ae/download/cb6d4011-5496-4930-aaf6-352d392cd049/concoursedfactfile.pdf) (accessed 2026-10-26): Concourse D 700 x 144 x 27 m, 150,000 m2, 32 gates, 18 mppa
- [Dubai Airports media: Terminal 2 fact file page](https://media.dubaiairports.ae/terminal-2/) (accessed 2026-10-26): T2 opening 1998, 12 gates, 43 remote stands, >12 mppa
- [Dubai Airports: DXB Terminal 2 fact file (PDF)](https://media.dubaiairports.ae/download/0bf76bf7-a0ab-41a3-a0a1-54fda21feacb/dxbt2factfile.pdf) (accessed 2026-10-26): T2 location north of T1, areas
- [Dubai Airports media: Cargo & Logistics fact file page](https://media.dubaiairports.ae/cargo--logistics/) (accessed 2026-10-26): CMT, DFC, cargo capacities, northern runway 2022 note
- [Dubai Airports Concourse A fact sheet (27 Dec 2012, Wayback Machine)](https://web.archive.org/web/20121230055256/http://www.dubaiairport.com/en/media-centre/facts-figures/pages/factsheets-reports-statistics.aspx?id=10) (accessed 2026-10-26): Concourse A 645 x 90.8 x 42 m, 11 floors, 13 remote stands
- [ACL: DXB S26 Capacity Declaration (delivered 2025-10-01)](https://www.acl-uk.org/wp-content/uploads/2025/10/S26-DXB-Capacity-Declaration.pdf) (accessed 2026-10-26): stand counts by apron/concourse and ICAO code
- [ACL: Northern Runway Rehabilitation closure (9 May - 22 June 2022)](https://www.acl-uk.org/dubai-northern-runway-rehabilitation/) (accessed 2026-10-26): runway 12L/30R refurbishment
- [Zawya (June 2026): Dubai Airports unveils new design of its ATC tower at DXB](https://www.zawya.com/en/business/aviation/dubai-airports-unveils-new-design-of-its-air-traffic-control-tower-at-dxb-tj2e58wf) (accessed 2026-10-26): tower 89 m, in operation since 2000, shape, UAE flag redesign
- [Moodie Davitt Report (2026-06-24): DXB ATC tower makeover](https://moodiedavittreport.com/images-of-the-day-dubai-international-airport-proudly-flies-uae-flag-with-air-control-tower-makeover/) (accessed 2026-10-26): same; date
- [BG&E: Dubai International Airport Terminal Expansion](https://bgeeng.com/projects/dubai-international-airport-terminal-expansion/) (accessed 2026-10-26): structural-steel vaulted concourse roof
- [Al Abbar Group: Dubai International Airport (via search summary)](https://www.alabbargroup.com/projects/dubai-international-airport/) (accessed 2026-10-26): 70,000 m2 standing-seam roofing, glazing and cladding of Concourse B
- Commons file pages for each photo are listed in the photo section above.

## OMSJ / SHJ: Sharjah International Airport

- AIP name: SHARJAH / INTERNATIONAL; city: Sharjah
- ARP: **25.3291667, 55.5161111** (AIP `251945N 0553058E`; site: Mid-point of TWY B (about 255 m from the current runway centreline - computed)). Source: [GCAA eAIP AD 2.2](https://www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/html/eAIP/AD-2.OMSJ-en-GB.html#OMSJ-AD-2.2)
  - Cross-check: 25°19′45″N 055°30′58″E (same as AIP), [Wikipedia](https://en.wikipedia.org/wiki/Sharjah_International_Airport)
- Aerodrome elevation: **119 ft / 36.3 m AMSL**; reference temperature 42 C; geoid undulation -111 ft. Source: [GCAA eAIP AD 2.2](https://www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/html/eAIP/AD-2.OMSJ-en-GB.html#OMSJ-AD-2.2)
  - Other value: 116 ft / 35 m (Wikipedia cites a 2013 AIP; current AIP says 119 ft), [Wikipedia](https://en.wikipedia.org/wiki/Sharjah_International_Airport)
- Magnetic variation: **2.0 deg E (2025)**, annual change 0.0 deg. Source: [GCAA eAIP AD 2.2](https://www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/html/eAIP/AD-2.OMSJ-en-GB.html#OMSJ-AD-2.2)

### Runways

| Runway | Length x width (m) | True bearing, AIP (deg) | True bearing, computed (deg) | Mag. bearing (deg) | Surface / PCR | Displaced THR (m) | Declared distances TORA / TODA / ASDA / LDA (m) |
|---|---|---|---|---|---|---|---|
| 12/30 | 4060 x 60 | 122.37/302.38 | 122.37/302.38 | 120.14/300.15 | asphalt / 786/F/A/W/T | 12: 300, 30: 300 | 12: 4060 / 4060 / 4060 / 3760<br>30: 4060 / 4060 / 4060 / 3760 |

Thresholds (landing thresholds; displaced where noted):

| THR | Lat | Lon | AIP DMS | Elevation | Displaced (m) |
|---|---|---|---|---|---|
| 12 | 25.3388111 | 55.5041056 | `252019.72N 0553014.78E` | 90 ft / 27.43 m | 300 |
| 30 | 25.3220833 | 55.5331333 | `251919.50N 0553159.28E` | 113 ft / 34.44 m | 300 |

- 12/30 pavement ends: NW (RWY 12 start): 25.3402583, 55.5015917 (`252024.93N 0553005.73E`); SE (RWY 30 start): 25.3206361, 55.5356472 (`251914.29N 0553208.33E`)
- 12/30 geodesic length from AIP coordinates: 4059.6 m. Notes: ONLY ONE runway is published. This is the "new runway" inaugurated 22 Oct 2014 (4,060 x 60 m, AED 500 m, design/supervision Halcrow, contractor Lane-NCTC, 8 new link taxiways + 2 rapid exits, CAT II). It was planned parallel to the original runway at ~250 m spacing (Airport Technology 2012). The AIP ARP ("mid-point of TWY B") lies ~255 m from the current centreline, consistent with the original runway now serving as parallel TWY B (inference, not stated by a source; TWY B published width 25 m). Both thresholds displaced by 300 m. A further additional runway was among plans reviewed in Feb 2025 (WAM) - not built/published. New in AIRAC AMDT 12/2026 (eff. 26 Nov 2026): runway closed for preventive maintenance every Tuesday 0600-0700 UTC.
  Sources: [www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/htm...](https://www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/html/eAIP/AD-2.OMSJ-en-GB.html#OMSJ-AD-2.12), [www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/htm...](https://www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/html/eAIP/AD-2.OMSJ-en-GB.html#OMSJ-AD-2.13), [www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/htm...](https://www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/html/eAIP/AD-2.OMSJ-en-GB.html#OMSJ-AD-2.8), [www.sharjahairport.ae/en/ruler-of-sharjah-inaugurates-sharjah-inter...](https://www.sharjahairport.ae/en/ruler-of-sharjah-inaugurates-sharjah-international-airports-new-runway-22nd-october-2014/), [www.airport-technology.com/projects/sharjah-international-airport-i...](https://www.airport-technology.com/projects/sharjah-international-airport-iata-shj-uae/), [gulfnews.com/business/aviation/sharjah-international-airport-opens-...](https://gulfnews.com/business/aviation/sharjah-international-airport-opens-new-dh500m-runway-1.1402489), [www.wam.ae/en/article/bidphxw-sharjah-reviews-expansion-project-upd...](https://www.wam.ae/en/article/bidphxw-sharjah-reviews-expansion-project-updates-sharjah)

- Aprons/stands: AIP AD 2.8: MAIN APRON stands 1A-1C and 2-8 (stands 3-8 have fixed ground power); EASTERN APRON 9-26; WESTERN APRON 29-40; CARGO APRON 50-62; MAINTENANCE APRON 80-84; maintenance area F1-F2; VIP apron.

### Terminals and concourses

#### Passenger terminal

- Type: terminal
- Opened: 1977 (Sharjah Airport milestones; 1 January 1977 per Wikipedia; Gulf News 2008 says built 1978). Terminal expanded 2008 (milestones; Airport Technology describes a Dh227 m 2005-2009 expansion); new expansion under way, target 2027
- Floor area: 105,300 m2 Other values: 125,000 m2 (Wikipedia citing EDS FZE).
- Gates: 8 (8 departure gates and 25 aircraft stands (Airport Technology, 2012); three air bridges added in the 2005-2009 expansion; AIP lists stands 1A-40 on the passenger aprons.)
- Capacity: 8 mppa (>8 mppa (2012). Expansion: 190,000 m2 terminal expansion (AED 1.235 bn) raising capacity to 20 mppa by 2027 (Gulf Construction Online, Feb 2024); SAA chairman: up to 25 mppa by mid-2027 (ME Construction News, Jun 2024).)
- Architect: Not identified. Gulf News (2008) credits the design of the domes to H.H. Sheikh Dr Sultan bin Mohammad Al Qasimi, Ruler of Sharjah.
- Plan shape: Compact terminal on the SOUTH side of the runway (~0.9 km from the runway centreline; parallel TWY B lies in between), composed around domes, with the original control tower standing beside it like a minaret.
- Roof: Domes of different sizes - four per Archnet (housing the main concourse, arrivals, departures and VIP areas), three per Gulf News 2008 - built as steel lattice structures clad in glass-reinforced plastic (GRP).
- Dimensions (m): OSM min. bounding rectangle (approx.): main terminal outline (OSM way 182512055 "Terminal 1") ~376 x 164 m, footprint ~33,300 m2, plus four small adjoining terminal buildings of 1,000-3,600 m2 each (approximate)
- Facade: Reinforced-concrete structure with pointed arches; the concrete arches are infilled with blue glazed-ceramic sun screens (Archnet).
- Colours: Light/white building with blue glazed-ceramic screens in the arches (Archnet); dome colour not documented - check photos.
- Features: Islamic-style architecture ("striking architectural features" - airport milestones page). The aerial photo below shows the "unique passenger terminal design".
- Sources: [archnet.org/sites/232](https://archnet.org/sites/232), [gulfnews.com/uae/still-flying-high-1.118843](https://gulfnews.com/uae/still-flying-high-1.118843), [www.airport-technology.com/projects/sharjah-international-airport-i...](https://www.airport-technology.com/projects/sharjah-international-airport-iata-shj-uae/), [en.wikipedia.org/wiki/Sharjah_International_Airport](https://en.wikipedia.org/wiki/Sharjah_International_Airport), [www.sharjahairport.ae/en/?p=7952](https://www.sharjahairport.ae/en/?p=7952), [gulfconstructiononline.com/Article/386536/Work_begins_on_$653m_Shar...](https://gulfconstructiononline.com/Article/386536/Work_begins_on_$653m_Sharjah_airport_expansion), [meconstructionnews.com/59807/sharjah-airport-expansion-works-on-tra...](https://meconstructionnews.com/59807/sharjah-airport-expansion-works-on-track-says-saa)

### Control towers

#### Original control tower (part of the 1977 terminal composition)

- Height: n/a (not published)
- Opened: 1977
- Shape: Slender minaret-like tower
- Description: Archnet: the control tower is "treated as a minaret" completing the composition with the domes. Height not published; the AIP AD 2.10 obstacle list does not include it.
- Sources: [archnet.org/sites/232](https://archnet.org/sites/232)

#### New ATC tower (2014 runway project)

- Height: n/a (not published)
- Opened: 2014
- Shape: n/a
- Description: Sharjah Airport: "A new Air Tower Control was established ... for emergency situations" together with the October 2014 runway. Location/height not published in the sources found.
- Sources: [www.sharjahairport.ae/en/ruler-of-sharjah-inaugurates-sharjah-inter...](https://www.sharjahairport.ae/en/ruler-of-sharjah-inaugurates-sharjah-international-airports-new-runway-22nd-october-2014/)

### Cargo

Sharjah Airport cargo centre (Freight Centre established 1979, expanded 1999 - airport milestones; first delegated cargo complex in the UAE per Gulf News): five cargo terminals beside a dedicated cargo apron; Sharjah Airport International Free Zone (SAIF Zone, operational since 1995) adjoins the airport.

- Five cargo terminals, total floor area 32,000 m2: T1 charter operations, T2 imports/RA3 exports, T3 freight forwarders, T4 customs and overflow imports, T5 scheduled operations (export, CEIV pharma)
- Dedicated cargo apron for up to 13 wide-body aircraft including 4 Code E stands (official); AIP CARGO APRON stands 50-62
- Forwarder warehouses of 1,200 m2 each plus 10 warehouses of 200 m2; cold storage, animal pens
- Capacity 500,000 t/yr; 332,796 t handled to Oct 2012 (Airport Technology, 2012)
- Sources: [www.sharjahairport.ae/en/business/cargo-centre/cargo-facilities/](https://www.sharjahairport.ae/en/business/cargo-centre/cargo-facilities/), [www.airport-technology.com/projects/sharjah-international-airport-i...](https://www.airport-technology.com/projects/sharjah-international-airport-iata-shj-uae/), [gulfnews.com/uae/still-flying-high-1.118843](https://gulfnews.com/uae/still-flying-high-1.118843), [www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/htm...](https://www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/html/eAIP/AD-2.OMSJ-en-GB.html#OMSJ-AD-2.8)

### Reference photos (Wikimedia Commons, license verified on the file page)

- **Aerial view of the airport at ~5,000 ft; the domed passenger terminal is clearly visible** - [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/), by G B_NZ, 2015, aerial: yes, 4608 x 3456 px. File page: [Commons](https://commons.wikimedia.org/wiki/File:Shahjah_Airport_(23533090656).jpg); original: [image](https://upload.wikimedia.org/wikipedia/commons/7/78/Shahjah_Airport_%2823533090656%29.jpg)
- **Passenger terminal (arrival & departure building), exterior** - [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), by Fadi Fayad Al Taoba, 2010, aerial: no, 2048 x 1536 px. File page: [Commons](https://commons.wikimedia.org/wiki/File:Sharjah_International_Airport_-_Arrival_%5E_Departure_Building_-_panoramio.jpg); original: [image](https://upload.wikimedia.org/wikipedia/commons/6/66/Sharjah_International_Airport_-_Arrival_%5E_Departure_Building_-_panoramio.jpg)
- **Passenger terminal area, landside (camera near 25.3181 N, 55.5187 E)** - [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), by Fadi Fayad Al Taoba, 2010, aerial: no, 2048 x 1536 px. File page: [Commons](https://commons.wikimedia.org/wiki/File:Sharjah_International_Airport_-_panoramio.jpg); original: [image](https://upload.wikimedia.org/wikipedia/commons/7/77/Sharjah_International_Airport_-_panoramio.jpg)
- **Sharjah airport terminal area (camera near 25.3218 N, 55.5208 E)** - [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), by Akhmad Fauzi, 2007, aerial: no, 2576 x 1716 px. File page: [Commons](https://commons.wikimedia.org/wiki/File:AIRPORT_SHARJAH_UAE_-_panoramio.jpg); original: [image](https://upload.wikimedia.org/wikipedia/commons/5/51/AIRPORT_SHARJAH_UAE_-_panoramio.jpg)
- **Sharjah airport terminal area (camera near 25.3196 N, 55.5192 E)** - [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/), by log-011, 2007, aerial: no, 2816 x 2112 px. File page: [Commons](https://commons.wikimedia.org/wiki/File:%D0%90%D1%8D%D1%80%D0%BE%D0%BF%D0%BE%D1%80%D1%82_%D0%A8%D0%B0%D1%80%D0%B4%D0%B6%D0%B0._-_panoramio.jpg); original: [image](https://upload.wikimedia.org/wikipedia/commons/6/63/%D0%90%D1%8D%D1%80%D0%BE%D0%BF%D0%BE%D1%80%D1%82_%D0%A8%D0%B0%D1%80%D0%B4%D0%B6%D0%B0._-_panoramio.jpg)
- **Apron at night: A320 on a contact stand with jet bridge and ground equipment** - [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), by Bahnfrend, 2025, aerial: no, 5754 x 3237 px. File page: [Commons](https://commons.wikimedia.org/wiki/File:Air_Arabia_Airbus_A320_A6-AOC_Sharjah_2025_(01).jpg); original: [image](https://upload.wikimedia.org/wikipedia/commons/7/7c/Air_Arabia_Airbus_A320_A6-AOC_Sharjah_2025_%2801%29.jpg)
- **Historic view, June 1990 (small image)** - [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), by Gereon K., 1990, aerial: no, 492 x 330 px. File page: [Commons](https://commons.wikimedia.org/wiki/File:Sharjah_airport_june_1990.jpg); original: [image](https://upload.wikimedia.org/wikipedia/commons/1/12/Sharjah_airport_june_1990.jpg). Historic, 492 x 330 px
- Gaps: Only one openly licensed aerial view was found; no photo of the 2014 ATC tower or the cargo terminals. The GFDL-only Airliners.net aerial (AN0942458) and the Free Art License aerial "UAE Dubai aerial view towards Sharjah asv2018-01" were excluded.

### Sources

- [UAE GCAA eAIP AD 2.OMSJ (AIRAC AMDT 12/2026 package, eff. 26 NOV 2026)](https://www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P12/html/eAIP/AD-2.OMSJ-en-GB.html) (accessed 2026-10-26): ARP, elevation, MAG VAR, runways, thresholds, declared distances, aprons, obstacle heights (AD 2.2, 2.8, 2.10, 2.12, 2.13)
- [UAE GCAA eAIP AD 2.OMSJ (AIRAC AMDT 09/2026 package, in force on 2026-10-26)](https://www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIRACs/2026-P08/html/eAIP/AD-2.OMSJ-en-GB.html) (accessed 2026-10-26): cross-check of AD 2.2/2.12/2.13
- [UAE GCAA eAIP index (package list and effective dates)](https://www.gcaa.gov.ae/en/ais/AIPHtmlFiles/AIP/Current/AIP.aspx) (accessed 2026-10-26): AIRAC cycle identification
- [Wikipedia: Sharjah International Airport](https://en.wikipedia.org/wiki/Sharjah_International_Airport) (accessed 2026-10-26): opening 1977, terminal area alt value, expansion target, history
- [Sharjah Airport: Ruler inaugurates new runway (22 Oct 2014)](https://www.sharjahairport.ae/en/ruler-of-sharjah-inaugurates-sharjah-international-airports-new-runway-22nd-october-2014/) (accessed 2026-10-26): runway 4,060 x 60 m, taxiways, CAT II, new ATC tower, Halcrow / Lane-NCTC
- [Sharjah Airport: milestones](https://www.sharjahairport.ae/en/?p=7952) (accessed 2026-10-26): opening with striking architectural features, freight centre, 2014 runway
- [Sharjah Airport: Cargo Centre facilities](https://www.sharjahairport.ae/en/business/cargo-centre/cargo-facilities/) (accessed 2026-10-26): five cargo terminals 32,000 m2, cargo apron 13 wide-body stands
- [Airport Technology: Sharjah International Airport (2012-11-08)](https://www.airport-technology.com/projects/sharjah-international-airport-iata-shj-uae/) (accessed 2026-10-26): terminal 105,300 m2, gates/stands, cargo capacity, planned parallel runway 250 m away
- [Gulf News (2008-07-18): Still flying high](https://gulfnews.com/uae/still-flying-high-1.118843) (accessed 2026-10-26): Islamic design, domes designed by the Ruler, 1979 cargo complex
- [Archnet: Sharjah International Airport (page behind bot check; via search-engine snippets)](https://archnet.org/sites/232) (accessed 2026-10-26): domes (steel lattice + GRP), RC arches with blue glazed-ceramic sun screens, minaret-like tower
- [Gulf News (2014): Sharjah International Airport opens new Dh500m runway](https://gulfnews.com/business/aviation/sharjah-international-airport-opens-new-dh500m-runway-1.1402489) (accessed 2026-10-26): runway dimensions, A380 capability
- [Gulf Construction Online (2024-02-01): Work begins on $653m Sharjah airport expansion](https://gulfconstructiononline.com/Article/386536/Work_begins_on_$653m_Sharjah_airport_expansion) (accessed 2026-10-26): 190,000 m2 terminal expansion, 20 mppa, 2027
- [ME Construction News (2024-06-19): Sharjah airport expansion works on track](https://meconstructionnews.com/59807/sharjah-airport-expansion-works-on-track-says-saa) (accessed 2026-10-26): up to 25 mppa by mid-2027
- [WAM (Feb 2025): Sharjah CP reviews expansion project updates (via search summary)](https://www.wam.ae/en/article/bidphxw-sharjah-reviews-expansion-project-updates-sharjah) (accessed 2026-10-26): plans for an additional runway and new terminal design
- Commons file pages for each photo are listed in the photo section above.

## OSM vs AIP cross-check

Filled by `pipeline/osm/build_layout.py` (2026-10-26) from the Geofabrik GCC extract (OSM data up to
2026-10-25T21:21Z) against the GCAA eAIP AD 2.12 values above. "OSM centreline" is the geodesic distance
between the two extreme points of all `aeroway=runway` pieces with the same `ref` (main runway way plus
`runway=displaced_threshold` pieces); stopways are excluded. Machine-readable copies:
`data/airports/<ICAO>/runway_crosscheck.json` and `osm_crosscheck` in `airports.json`.

| Airport | Runway | OSM centreline m | OSM `length` tag | AIP length m | OSM - AIP m | width OSM / AIP m | true bearing OSM | true bearing from AIP coords | ends |
|---|---|---|---|---|---|---|---|---|---|
| OMAA | 13L/31R | 4098.9 | 4100 | 4100 | -1.1 | 60 / 60 | 127.78 / 307.79 | 127.78 / 307.79 | 13L: OSM end vs AIP THR +3.6 m along / 0.2 m across; 31R: OSM end vs AIP THR -0.0 m along / 4.8 m across |
| OMAA | 13R/31L | 4102.7 | 4100 | 4106 | -3.3 | 60 / 60 | 127.78 / 307.79 | 127.78 / 307.79 | 13R: OSM end vs AIP THR +0.0 m along / 0.5 m across; 31L: OSM end vs AIP THR -0.0 m along / 2.6 m across |
| OMDB | 12L/30R | 4345.1 | 4300 | 4351 | -5.9 | 60 / 60 | 121.38 / 301.40 | 121.36 / 301.38 | 12L: AIP displaced THR 450 m, OSM pavement end -> AIP THR 447.8 m, OSM end vs AIP runway end 3.0 m; 30R: AIP displaced THR 300 m, OSM pavement end -> AIP THR 297.4 m, OSM end vs AIP runway end 3.4 m |
| OMDB | 12R/30L | 4434.9 | 4447 | 4447 | -12.1 | 60 / 60 | 121.37 / 301.39 | 121.36 / 301.38 | 12R: AIP displaced THR 715 m, OSM pavement end -> AIP THR 716.9 m, OSM end vs AIP runway end 1.8 m; 30L: AIP displaced THR 132 m, OSM pavement end -> AIP THR 118.3 m, OSM end vs AIP runway end 14.3 m |
| OMSJ | 12/30 | 4060.4 | (none) | 4060 | +0.4 | 60 / 60 | 122.36 / 302.37 | 122.37 / 302.38 | 12: AIP displaced THR 300 m, OSM pavement end -> AIP THR 301.1 m, OSM end vs AIP runway end 1.7 m; 30: AIP displaced THR 300 m, OSM pavement end -> AIP THR 298.9 m, OSM end vs AIP runway end 0.8 m |

Findings:

* **Geometry agrees with the AIP to within metres.** All OSM runway ends lie within 0-5 m of the AIP
  threshold/runway-end coordinates (cross-track <= 4.8 m), except the DXB 30L pavement end, which OSM
  draws 14.3 m short of the AIP runway end; the OSM-derived true bearings match the bearings computed
  from the AIP coordinates to <= 0.02 deg (the AIP tabulates OMAA/OMDB bearings as whole degrees).
* **Length differences** (OSM shorter): OMAA 13L/31R -1.1 m, 13R/31L -3.3 m; OMDB 12L/30R -5.9 m,
  12R/30L -12.1 m (the 30L end, see above); OMSJ 12/30 +0.4 m. All within 0.3 %.
* **OSM `length` tags are stale/rounded:** OMAA 13R/31L is tagged 4100 m (AIP 4106 m); OMDB 12L/30R is
  tagged 4300 m (AIP 4351 m; Wikipedia's body text still says 4,000 m). The pipeline ignores the tags
  and measures the geometry. Widths (60 m) agree everywhere; OMAA 13R/31L stopway pieces are tagged
  45 m wide (stopways are not part of the runway in the layout).
* **Displaced thresholds** (DXB 12L 450 m, 30R 300 m, 12R 715 m, 30L 132 m; SHJ 12 and 30 300 m each)
  are not explicit in OSM; layout.json places each landing threshold (`threshold_node`, `x`, `y`) at the
  AIP threshold coordinate projected onto the OSM centreline and keeps the pavement end as `end_node` /
  `end_x`, `end_y`. `displaced_threshold_m` in layout.json is measured from the OSM pavement end (DXB 30L:
  118.3 m vs the AIP's 132 m, because of the 14 m shorter OSM pavement).
* OMAA has no displaced thresholds; OSM ends coincide with the AIP thresholds (13L end 3.6 m beyond).
