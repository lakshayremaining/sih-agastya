with open('c:/Users/LAKSHAY/OneDrive/Desktop/sih/PS26085Prototype/frontend/src/lib/networkData.ts', 'a', encoding='utf-8') as f:
    f.write('''

export interface DestinationItem {
  id: string;
  name: string;
  icon: string;
  area: string;
  badge: string;
}

export const STARTING_LOCATIONS_12: DestinationItem[] = [
  { id: "delhi_university", name: "1. Delhi University (North Campus)", icon: "??", area: "DU Campus / Mall Road", badge: "University Hub" },
  { id: "kashmere_gate_isbt", name: "2. Kashmere Gate ISBT Junction", icon: "??", area: "ISBT Ring Road", badge: "Primary Dispatch" },
  { id: "cp_outer_n", name: "3. CP Outer Circle North", icon: "??", area: "Connaught Place", badge: "Emergency Response" },
  { id: "cp_outer_e", name: "4. CP Outer Circle East", icon: "??", area: "CP Outer East", badge: "Radial Hub 1" },
  { id: "barakhamba_junction", name: "5. Barakhamba Road Hub", icon: "??", area: "Connaught Place", badge: "Trauma Hub" },
  { id: "ito_junction", name: "6. ITO Medical Hub", icon: "??", area: "ITO Junction", badge: "Super Specialty" },
  { id: "ndls_railway_station", name: "7. NDLS Station Entry", icon: "??", area: "Paharganj Gate", badge: "Transit Hub" },
  { id: "tilak_bridge", name: "8. Tilak Bridge Circle", icon: "??", area: "BSZ Marg", badge: "Apex Facility" },
  { id: "panchkuian_road_1", name: "9. Panchkuian Road Hub", icon: "??", area: "Sansad Marg", badge: "Emergency Hub" },
  { id: "ddu_marg_east", name: "10. DDU Marg East", icon: "??", area: "DDU Marg", badge: "General Hospital" },
  { id: "rml_hospital", name: "11. RML Hospital Terminal", icon: "??", area: "RML Trauma", badge: "Super Specialty" },
  { id: "cp_inner_n", name: "12. CP Radial Inner Circle", icon: "??", area: "Central Park", badge: "First Aid Hub" },
  { id: "minto_north", name: "13. Minto Road North Gate", icon: "??", area: "Minto Ingress", badge: "Dispatch Depot" },
  { id: "lady_hardinge_hospital", name: "14. Lady Hardinge Medical College & Hospital", icon: "??", area: "Panchkuian / CP West", badge: "Super Specialty Hospital" }
];

export const TOP_15_DESTINATIONS = STARTING_LOCATIONS_12;
''')
