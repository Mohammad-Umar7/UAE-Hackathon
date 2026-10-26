"""Asset registry: every exported GLB, its builder, LODs, morph targets and metadata."""
from . import furniture, gse, jetbridge, vegetation


class Spec:
    def __init__(self, name, category, fn, lods=(0, 1, 2), morphs=(), colors=None, desc='',
                 extras=None, empties=None, preview=None):
        self.name = name
        self.category = category
        self.fn = fn
        self.lods = lods
        self.morphs = tuple(morphs)
        self.colors = colors or {}
        self.desc = desc
        self.extras = extras or {}
        self.empties = empties or {}
        self.preview = preview or {}


def C(**kw):
    """Material colour overrides: C(M_Body='#hex', ...) or dicts."""
    out = {}
    for k, v in kw.items():
        out[k] = v if isinstance(v, dict) else {'color': v}
    return out


WHITE = '#E9EAE6'
YELLOW = {'color': '#F2B100', 'rough': 0.32}
GSE_WHITE = {'color': WHITE, 'rough': 0.32}

JB_COLORS = C(M_Body={'color': '#D5D8DA', 'rough': 0.42}, M_Trim={'color': '#5C636B', 'rough': 0.5})
JB_GLASS_COLORS = dict(JB_COLORS, M_Glass={'color': '#9FB7C0', 'rough': 0.03, 'alpha': 0.28})
JB_EMPTIES = {
    'TUNNEL_A_MOUNT': 'child of JB_Rotunda: where JB_Tunnel_A origin sits at yaw 0 (floor level 5.0); '
                      'A yaws about the vertical rotunda axis through the root origin and pitches about its origin',
    'TUNNEL_B_RETRACTED': 'child of JB_Tunnel_A: JB_Tunnel_B origin when fully retracted (local_m is in A space; '
                          'includes the 7 cm roller ride height)',
    'TUNNEL_B_EXTENDED': 'child of JB_Tunnel_A: JB_Tunnel_B origin when fully extended (local_m in A space)',
    'CAB_PIVOT': 'child of JB_Tunnel_B: JB_Cab origin (cab yaw pivot); local_m in B space',
    'DRIVE_COLUMN_MOUNT': 'child of JB_Tunnel_B: underside of B where the lift yoke top attaches; '
                          'JB_DriveColumn origin goes on the ground directly below it',
    'CAB_DOCK': 'child of JB_Cab: front face of the cab bumper at cab floor level; align with the aircraft DOOR_* sill',
    'BEACON': 'child of JB_Cab: cab roof beacon',
}
JB_NOTES = {
    'b_travel_m': [3.5, 12.0], 'b_rest_m': 7.0, 'b_ride_height_m': 0.07, 'cab_pivot_on_b_m': 13.3,
    'drive_column_on_b_m': 11.0, 'rotunda_floor_m': 5.0, 'tunnel_a_mount_radius_m': 1.45,
    'lift_node': 'JB_DriveColumn_Lift: set its local z so that its origin meets DRIVE_COLUMN_MOUNT',
}
TOW = {'TOW_HITCH': 'rear coupling pin (next cart TOW_EYE attaches here)',
       'TOW_EYE': 'drawbar towing eye (attach to the TOW_HITCH ahead)', 'BEACON': 'amber beacon centre',
       'BEACON_2': 'second amber beacon'}
LIFT_NOTE = 'Lift node morph targets: weight 0 = transport pose, 1 = fully raised/extended (see README)'

ASSETS = [
    # ------------------------------------------------------------ jet bridges
    Spec('jet_bridge', 'jet_bridge', jetbridge.jet_bridge, colors=JB_COLORS, extras=JB_NOTES, empties=JB_EMPTIES,
         desc='Apron-drive passenger boarding bridge: corrugated steel tunnels, rotunda with service stairs, '
              'drive column on solid tyres, cab with bellows canopy and bumper. Rotunda centre to bumper: '
              '25.0 m at rest, 21.5-30.0 m over the B travel; rotunda floor 5.0 m.'),
    Spec('jet_bridge_glass', 'jet_bridge', jetbridge.jet_bridge_glass, colors=JB_GLASS_COLORS, extras=JB_NOTES,
         empties=JB_EMPTIES, desc='Same part contract as jet_bridge with glazed tunnel side walls '
                                  '(alpha-blended M_Glass, visible interior floor/ceiling/lighting).'),
    # ------------------------------------------------------------ GSE
    Spec('pushback_tug', 'gse', gse.pushback_tug, colors=C(M_Body=GSE_WHITE),
         desc='Towbarless pushback tug (7.6 x 3.3 x 1.6 m) with nose-wheel cradle at the rear.',
         empties={'TOW_HITCH': 'nose-gear tyre contact point when captured in the cradle (align aircraft origin)',
                  'BEACON': 'amber beacon centre'}),
    Spec('baggage_tractor', 'gse', gse.baggage_tractor, colors=C(M_Body=YELLOW),
         desc='Enclosed-cab electric baggage tractor (~3.3 x 1.4 x 2.1 m) with rear tow hitch.', empties=TOW),
    Spec('baggage_cart', 'gse', gse.baggage_cart, colors=C(M_Body={'color': '#2F64A8', 'rough': 0.4}),
         desc='Covered baggage cart with open sides, roof and luggage load (3.2 m + drawbar).', empties=TOW),
    Spec('uld_dolly', 'gse', gse.uld_dolly, colors=C(M_Body={'color': '#3C4650', 'rough': 0.5}),
         desc='ULD dolly with roller deck and drawbar carrying an LD3 (AKE) container.', empties=TOW),
    Spec('belt_loader', 'gse', gse.belt_loader, morphs=('Raise',), colors=C(M_Body=GSE_WHITE),
         desc='Self-propelled belt loader (7.6 x 2.0 m); conveyor front end 2.2 m, Raise morph lifts it to 4.0 m.',
         extras={'morph_Raise': 'belt front end 2.2 m -> 4.0 m (boom pivots at its rear end)', 'note': LIFT_NOTE},
         empties={'BELT_TOP': 'top end of the belt at Raise = 0', 'BEACON': 'amber beacon centre'}),
    Spec('catering_truck', 'gse', gse.catering_truck, morphs=('Raise', 'Extend'), colors=C(M_Body=GSE_WHITE),
         desc='High-loader catering truck with scissor-lift box body (9 x 2.5 x 3.9 m).',
         extras={'morph_Raise': 'box floor 1.42 m -> 5.82 m (+4.40 m)', 'morph_Extend': 'front platform +2.50 m (+Y)',
                 'note': LIFT_NOTE},
         empties={'PLATFORM_EDGE': 'front platform bumper at Raise = Extend = 0 (add +4.40 z per Raise, +2.50 y '
                                   'per Extend)', 'BEACON': 'cab roof beacon'}),
    Spec('fuel_hydrant_dispenser', 'gse', gse.fuel_hydrant_dispenser, colors=C(M_Body=GSE_WHITE),
         desc='Hydrant dispenser truck with filter vessel, hose reels, inlet hose with coupler and platform.',
         empties={'HYDRANT_COUPLER': 'parked hydrant coupler', 'BEACON': 'cab roof beacon'}),
    Spec('fuel_tanker', 'gse', gse.fuel_tanker, colors=C(M_Body=GSE_WHITE),
         desc='6x4 aviation refueller (10.5 x 2.5 x 3.4 m), elliptical tank, top walkway, rear hose cabinet.',
         empties={'HOSE_REEL': 'main delivery hose reel', 'BEACON': 'cab roof beacon'}),
    Spec('gpu_cart', 'gse', gse.gpu_cart, colors=C(M_Body={'color': '#E8E2D0', 'rough': 0.4}),
         desc='Towable 90 kVA ground power unit with coiled 400 Hz cable.',
         empties={'TOW_EYE': 'drawbar towing eye', 'CABLE_PLUG': 'parked 400 Hz plug'}),
    Spec('stairs_truck', 'gse', gse.stairs_truck, morphs=('Raise',), colors=C(M_Body=GSE_WHITE),
         desc='Self-propelled passenger stairs with covered top platform; Raise morph 3.4 m -> 5.8 m.',
         extras={'morph_Raise': 'top platform 3.40 m -> 5.80 m', 'note': LIFT_NOTE}, preview={'az': 215.0},
         empties={'PLATFORM_EDGE': 'top platform bumper at Raise = 0', 'BEACON': 'canopy beacon (Raise = 1 height)'}),
    Spec('ambulift', 'gse', gse.ambulift, morphs=('Raise', 'Extend'), colors=C(M_Body=GSE_WHITE),
         desc='PRM high-lift vehicle (ambulift): windowed cabin on scissor lift, front platform, rear tail lift.',
         extras={'morph_Raise': 'cabin floor 1.45 m -> 7.85 m (+6.40 m)', 'morph_Extend': 'front platform +1.60 m',
                 'note': LIFT_NOTE},
         empties={'PLATFORM_EDGE': 'front platform bumper at Raise = Extend = 0', 'BEACON': 'cab roof beacon'}),
    Spec('follow_me_car', 'gse', gse.follow_me_car, colors=C(M_Body={'color': '#F5C400', 'rough': 0.28}),
         desc='FOLLOW ME SUV with checker band, roof sign, two beacons and LED light bar.', empties=TOW),
    Spec('arff_tender', 'gse', gse.arff_tender, colors=C(M_Body={'color': '#C2121C', 'rough': 0.30},
                                                           M_Trim={'color': '#2B2D30', 'rough': 0.5}),
         desc='6x6 airport rescue & firefighting tender (12 x 3 x 3.7 m) with roof and bumper turrets.',
         empties={'TURRET': 'roof monitor nozzle tip', 'BEACON': 'rear beacon'}),
    Spec('apron_bus', 'gse', gse.apron_bus, colors=C(M_Body=GSE_WHITE, M_Trim={'color': '#2A2E33', 'rough': 0.45}),
         desc='Low-floor airside apron bus (13.9 x 3.0 x 2.95 m), 3 doors right / 2 doors left.',
         empties={'BEACON': 'roof beacon', 'DOOR_R1': 'right door sill centre', 'DOOR_R2': 'right door sill centre',
                  'DOOR_R3': 'right door sill centre', 'DOOR_L1': 'left door sill centre',
                  'DOOR_L2': 'left door sill centre'}),
    Spec('main_deck_loader', 'gse', gse.main_deck_loader, morphs=('Raise', 'RaiseRear'), colors=C(M_Body=YELLOW),
         desc='Main deck cargo loader (12 x 3.6 m) with roller platforms and elevating operator cab.',
         extras={'morph_Raise': 'front bridge platform + cab +4.60 m', 'morph_RaiseRear': 'rear platform +4.60 m',
                 'note': LIFT_NOTE},
         empties={'BRIDGE_EDGE': 'front bridge bumper at Raise = 0', 'BEACON': 'operator cab beacon at Raise = 0'}),
    Spec('service_van', 'gse', gse.service_van, colors=C(M_Body=GSE_WHITE),
         desc='Airside maintenance van (5.9 x 2.0 x 2.5 m) with roof rack, ladder and LED light bar.', empties=TOW),
    # ------------------------------------------------------------ furniture (no LODs)
    Spec('runway_edge_light', 'furniture', furniture.runway_edge_light, lods=(0,), colors=C(M_Body=YELLOW),
         desc='Elevated runway edge light, 0.36 m, frangible coupling, white lens.'),
    Spec('taxiway_edge_light', 'furniture', furniture.taxiway_edge_light, lods=(0,), colors=C(M_Body=YELLOW),
         desc='Elevated taxiway edge light, 0.30 m, blue omnidirectional dome lens.'),
    Spec('inset_light', 'furniture', furniture.inset_light, lods=(0,),
         desc='Flush in-pavement light, 0.30 m disc with two prism windows (white lens; tint per light colour).'),
    Spec('approach_light_bar', 'furniture', furniture.approach_light_bar, lods=(0,),
         colors=C(M_Body={'color': '#E4561C', 'rough': 0.5}),
         desc='Approach light crossbar (4.2 m) with 5 lamps on a 2.0 m frangible mast; lamps aim +Y.',
         empties={'LAMP_AIM': 'point 1 m in front of the lamps (aim direction)'}),
    Spec('papi_unit', 'furniture', furniture.papi_unit, lods=(0,), colors=C(M_Body=YELLOW),
         desc='PAPI light unit on frangible legs, lenses aim +Y.'),
    Spec('windsock', 'furniture', furniture.windsock, lods=(0,),
         colors=C(M_Body={'color': '#F06414', 'rough': 0.8, 'double': True},
                  M_Trim={'color': '#F2F2EE', 'rough': 0.8, 'double': True}),
         desc='6 m windsock mast; child node Sock (pivot at the mast top) yaws about Z to point downwind (+Y).'),
    Spec('apron_flood_mast', 'furniture', furniture.apron_flood_mast, lods=(0,),
         desc='30 m apron floodlight mast with 8-luminaire head (lamps on M_Lights).',
         empties={'LIGHT_HEAD': 'centre of the luminaire ring (spot light source)'}),
    Spec('taxi_sign', 'furniture', furniture.taxi_sign, lods=(0,),
         colors=C(M_Trim={'color': '#2B2E31', 'rough': 0.6}),
         desc='Airfield guidance sign box, face 2.4 x 1.1 m; front M_SignFace and back M_SignFaceBack, UV 0-1.',
         empties={'FACE_FRONT': 'centre of the front sign face'}),
    Spec('ils_localizer', 'furniture', furniture.ils_localizer, lods=(0,),
         colors=C(M_Metal={'color': '#B3B7BA', 'rough': 0.35, 'metal': 1.0, 'double': True}),
         desc='ILS localizer antenna array (14 LPDA elements, 26 m) with equipment shelter; radiates +Y.'),
    Spec('glide_slope_mast', 'furniture', furniture.glide_slope_mast, lods=(0,),
         colors=C(M_Body={'color': '#E4561C', 'rough': 0.55, 'double': True},
                  M_Trim={'color': '#F0F0EC', 'rough': 0.55, 'double': True}),
         desc='15 m glide slope lattice mast with 3 antenna panels (+Y) and shelter.'),
    Spec('blast_fence', 'furniture', furniture.blast_fence, lods=(0,), colors=C(M_Body={'color': '#C9CCCF', 'rough': 0.5}),
         desc='Jet blast deflector fence segment (6.0 m, tiles along X), louvres face +Y.'),
    Spec('perimeter_fence', 'furniture', furniture.perimeter_fence, lods=(0,),
         colors=C(M_Metal={'color': '#9EA3A8', 'rough': 0.4, 'metal': 1.0, 'double': True}),
         desc='Security fence segment (3.0 m, tiles along X), chain-link alpha mesh, barbed-wire outrigger.'),
    Spec('road_light', 'furniture', furniture.road_light, lods=(0,),
         desc='10 m street light with outreach arm and LED head.',
         empties={'LIGHT_HEAD': 'luminaire light emitting centre'}),
    # ------------------------------------------------------------ vegetation / context
    Spec('date_palm_a', 'vegetation', vegetation.date_palm_a, desc='Young date palm (~6.5 m).'),
    Spec('date_palm_b', 'vegetation', vegetation.date_palm_b, desc='Mature date palm (~9.5 m), slight lean.'),
    Spec('date_palm_c', 'vegetation', vegetation.date_palm_c, desc='Tall date palm (~12.5 m) with date clusters.'),
    Spec('shrub', 'vegetation', vegetation.shrub, lods=(0,), desc='Landscaping shrub (~1.3 m).'),
    Spec('car_sedan', 'context', vegetation.car_sedan, desc='Low-poly sedan for car parks (M_Body = paint).'),
    Spec('car_suv', 'context', vegetation.car_suv, desc='Low-poly SUV for car parks (M_Body = paint).'),
]


def by_name(name):
    for s in ASSETS:
        if s.name == name:
            return s
    return None
