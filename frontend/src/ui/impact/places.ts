/** City names for the origin airports used by the synthetic schedules (real airports, fictional flights). */
export const ORIGIN_CITY: Record<string, string> = {
  EGLL: "London", LFPG: "Paris", EDDF: "Frankfurt", EHAM: "Amsterdam", LIRF: "Rome", LEMD: "Madrid", KJFK: "New York",
  KIAD: "Washington", WSSS: "Singapore", VHHH: "Hong Kong", RJTT: "Tokyo", YSSY: "Sydney", ZBAA: "Beijing", FAOR: "Johannesburg",
  HKJK: "Nairobi", LTFM: "Istanbul", VTBS: "Bangkok", WMKK: "Kuala Lumpur", RKSI: "Seoul", LSZH: "Zurich",
  VIDP: "Delhi", VABB: "Mumbai", VOBL: "Bengaluru", VOMM: "Chennai", OPKC: "Karachi", OPLA: "Lahore", OPIS: "Islamabad",
  HECA: "Cairo", OEJN: "Jeddah", OERK: "Riyadh", LCLK: "Larnaca", LGAV: "Athens", UBBB: "Baku", UTTT: "Tashkent",
  VCBI: "Colombo", VNKT: "Kathmandu", HAAB: "Addis Ababa", OJAI: "Amman",
  OTHH: "Doha", OBBI: "Bahrain", OKKK: "Kuwait", OOMS: "Muscat", OOSA: "Salalah", OEDF: "Dammam", OIII: "Tehran", OISS: "Shiraz",
  OMAA: "Abu Dhabi", OMDB: "Dubai", OMSJ: "Sharjah",
};

export const originCity = (icao: string) => ORIGIN_CITY[icao] ?? icao;
