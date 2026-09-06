# Futuristic military base — modular asset catalog

**109 planned asset types**, organized around base functions and typed connections. This is an art and procedural-design specification, not a completed model pack. The existing sentry collection supplies the weapons for the emplacement assets.

All footprints below are **reserved plots in 4 m cells**, written X × Z. A 4 × 3 barracks reserves 16 × 12 m; its building mesh is smaller so doors, paths and service access fit. Small props occupy sockets within a plot rather than consuming a full empty 4 m square.

**Destruction convention:** D0 intact, D1 damaged, D2 critically damaged, D3 destroyed. These are three destruction levels **plus** the intact model, and are independent of equipment upgrade tiers. Every physical asset has all four states.

## Ground and foundations

| ID | Individual asset | Plot | Function and placement logic |
| --- | --- | --- | --- |
| `foundation_flat` | Universal foundation | 1 × 1 | Modular armored slab; foundation for larger plots. |
| `foundation_edge` | Foundation retaining edge | 1 × 1 | Exposed edge with structural ribs; cap platform boundaries. |
| `foundation_corner` | Foundation retaining corner | 1 × 1 | Connect two retaining edges at a right angle. |
| `foundation_ramp` | Foundation access ramp | 2 × 2 | Connect one supported platform elevation step to a vehicle road. |
| `foundation_pier` | Adjustable support pier | 1 × 1 | Support elevated slabs; finite authored height variants. |
| `foundation_bridge` | Utility bridge deck | 2 × 2 | Road-bearing deck with explicit support sockets. |
| `ground_hardstand` | Cargo hardstand | 2 × 2 | Flat logistics apron with cargo placement sockets. |
| `ground_drain` | Drainage channel | 1 × 1 | Collect runoff along road and platform edges. |

## Roads and circulation

| ID | Individual asset | Plot | Function and placement logic |
| --- | --- | --- | --- |
| `road_straight` | Vehicle road straight | 2 × 2 | 8 m road corridor; connect gates, loading bays and hangars. |
| `road_corner` | Vehicle road corner | 2 × 2 | Right-angle bend; rotate for other orientations. |
| `road_t` | Vehicle road T-junction | 2 × 2 | Three-port junction; reserve its entire turning area. |
| `road_cross` | Vehicle road crossroads | 2 × 2 | Four-port intersection; never use as a prop socket. |
| `road_end` | Vehicle road terminal | 2 × 2 | End-cap for a service bay; not a turning area. |
| `road_turnaround` | Vehicle turning court | 4 × 4 | Dead-end turnaround for the declared vehicle class. |
| `road_checkpoint` | Road inspection strip | 2 × 2 | Scanner and embedded status lights; a logical gate approach. |
| `road_crossing` | Marked pedestrian crossing | 2 × 2 | Road continuity plus a protected pedestrian crossing. |
| `walk_straight` | Pedestrian corridor | 1 × 1 | 4 m reserved corridor containing a 2 m clear walking lane. |
| `walk_corner` | Pedestrian corner | 1 × 1 | Join personnel-zone footpaths. |
| `walk_t` | Pedestrian T-junction | 1 × 1 | Connect building entrances to the walking network. |
| `walk_stairs` | Pedestrian stair module | 1 × 2 | One authored elevation step; accessibility requires an alternate ramp. |

## Perimeter and access

| ID | Individual asset | Plot | Function and placement logic |
| --- | --- | --- | --- |
| `wall_standard` | Armored wall section | 1 × 1 | 4 m segment with a readable central armor panel. |
| `wall_heavy` | Heavy blast wall section | 1 × 1 | Same endpoints as standard wall; thicker layered silhouette. |
| `wall_low` | Low cover barrier | 1 × 1 | Free-standing cover; cannot substitute for a sealed perimeter wall. |
| `wall_corner` | Armored wall corner | 1 × 1 | Right-angle perimeter corner. |
| `wall_t` | Internal partition T-wall | 1 × 1 | Branch an internal courtyard from the perimeter. |
| `wall_end` | Wall termination cap | 1 × 1 | Cap an intentional open end; invalid on a sealed perimeter. |
| `wall_buttress` | Wall reinforcement buttress | 1 × 1 | Periodic reinforcement that preserves wall connection positions. |
| `gate_vehicle` | Armored vehicle gate | 3 × 2 | 8 m vehicle crossing; gate leaves and frame damage independently. |
| `gate_personnel` | Personnel airlock gate | 1 × 1 | Foot access with two doors and a compact vestibule. |
| `gate_checkpoint_booth` | Gate control booth | 2 × 1 | Connect to gate-control socket outside the road envelope. |
| `fence_sensor` | Sensor fence segment | 1 × 1 | Lightweight monitored boundary for internal utility yards. |
| `fence_corner` | Sensor fence corner | 1 × 1 | Turn a fenced utility boundary; no mixing with wall ports. |

## Defense and observation

| ID | Individual asset | Plot | Function and placement logic |
| --- | --- | --- | --- |
| `defense_sentry_socket` | Universal sentry emplacement | 2 × 2 | Receives one existing turret family; separate turret and plinth health. |
| `defense_artillery_socket` | Artillery stabilizer pad | 3 × 3 | Reserved envelope for Howitzer legs and recoil motion. |
| `defense_a6_dock` | Heptapod A6 anchor berth | 3 × 3 | Six anchor sockets plus a clear approach for the mobile missile unit. |
| `defense_watchtower` | Observation watchtower | 2 × 2 | Elevated optics, searchlight and ladder; supported upper platform. |
| `defense_bunker` | Armored defense bunker | 3 × 2 | Protected room with separate firing aperture and rear entrance. |
| `defense_shield_projector` | Shield projector pylon | 2 × 2 | Pairs with another pylon to produce a game-only barrier field. |
| `defense_decoy` | Holographic decoy emitter | 1 × 1 | Destructible physical projector with an independently removable hologram. |
| `defense_searchlight` | Tracking searchlight mast | 1 × 1 | Gimballed lamp assigned to a wall observation socket. |
| `defense_radar` | Folding radar array | 2 × 2 | Rotating or folding dish; belongs to the sensor network. |
| `defense_interceptor` | Interceptor drone nest | 2 × 2 | Small defensive drone garage; reserve its launch clearance. |

## Command and communications

| ID | Individual asset | Plot | Function and placement logic |
| --- | --- | --- | --- |
| `command_hq` | Command nexus | 5 × 4 | Central command hub with roof sensor crown and protected entry. |
| `command_operations` | Tactical operations annex | 3 × 3 | Expandable operations wing connected by an enclosed walkway. |
| `command_comms` | Communications tower | 2 × 2 | Communications backbone with a visible antenna silhouette. |
| `command_server` | Armored server vault | 3 × 2 | Data storage with cooling and dual power-feed sockets. |
| `command_uplink` | Orbital uplink dish | 3 × 3 | Large sky-facing dish; reserve a clear overhead envelope. |
| `command_beacon` | Navigation and identity beacon | 1 × 1 | Base identity landmark; place at a road or landing-zone boundary. |

## Personnel and medical

| ID | Individual asset | Plot | Function and placement logic |
| --- | --- | --- | --- |
| `personnel_barracks` | Barracks module | 4 × 3 | Repeatable sleeping wing with two footpath entrances. |
| `personnel_infirmary` | Infirmary | 4 × 3 | Medical wing with a separate patient-transfer entrance. |
| `personnel_triage` | Deployable triage shelter | 3 × 2 | Expandable treatment canopy next to infirmary transfer route. |
| `personnel_mess` | Mess hall and galley | 4 × 4 | Personnel commons with a rear supply entrance. |
| `personnel_hygiene` | Hygiene and decontamination block | 3 × 2 | Connect water and waste systems; border workshop and personnel zones. |
| `personnel_recreation` | Gravity-training and recreation room | 3 × 3 | Distinctive rounded roof and an outdoor assembly socket. |
| `personnel_shelter` | Emergency shelter | 3 × 3 | Protected fallback room with an independent exit. |
| `personnel_airlock` | Enclosed corridor and airlock | 1 × 2 | Join compatible building corridor sockets without blocking outside paths. |

## Logistics and storage

| ID | Individual asset | Plot | Function and placement logic |
| --- | --- | --- | --- |
| `logistics_warehouse` | Modular warehouse | 5 × 4 | Storage hall with one loading dock and side personnel door. |
| `logistics_loading_dock` | Loading dock extension | 3 × 2 | Snap to warehouse service face; keep forklift approach clear. |
| `logistics_crane` | Cargo handling crane | 2 × 2 | Base, mast and boom are separate damage components; reserve swept volume. |
| `logistics_container` | Sealed cargo container | 3 × 1 | Stack only on rated container supports; front-door access required. |
| `crate_general` | Stackable supply crate | 1 × 1 | Small mesh inside one placement cell; stack-keyed top and bottom. |
| `crate_medical` | Medical supply crate | 1 × 1 | White/teal identity; spawn at infirmary or logistics sockets. |
| `crate_energy` | Power-cell transport crate | 1 × 1 | Insulated casing with charge indicator; abstract game resource. |
| `crate_parts` | Mechanical spare-parts crate | 1 × 1 | Industrial identity; workshop and vehicle service sockets. |
| `crate_secure` | Armored equipment locker | 1 × 1 | Heavy lock geometry; storage and barracks supply sockets. |
| `logistics_pallet` | Cargo pallet and restraint frame | 1 × 1 | Reusable carrier for crates; validates maximum supported stack. |

## Industry and maintenance

| ID | Individual asset | Plot | Function and placement logic |
| --- | --- | --- | --- |
| `industry_workshop` | Modular repair workshop | 4 × 3 | Main maintenance hall with service-door road connection. |
| `industry_garage` | Vehicle repair garage | 5 × 4 | Drive-in repair bay; clearance depends on declared vehicle class. |
| `industry_fabricator` | Field fabrication hall | 4 × 4 | Enclosed printers and machinery; logistics and power adjacency. |
| `industry_drone_bench` | Drone assembly shelter | 3 × 2 | Compact robotics maintenance building with small drone service sockets. |
| `industry_recycler` | Salvage recycling plant | 3 × 3 | Receives wreckage resources from a clear cargo approach. |
| `industry_service_lift` | Vehicle service lift | 2 × 3 | Lift platform and support arms; restrict vehicle class by envelope. |
| `industry_tool_rack` | Modular tool and manipulator rack | 1 × 1 | Workshop interior or sheltered apron placement. |
| `industry_test_cell` | Shielded equipment test cell | 3 × 3 | Enclosed game-equipment test room with independent service access. |

## Power, life support and utilities

| ID | Individual asset | Plot | Function and placement logic |
| --- | --- | --- | --- |
| `utility_reactor` | Compact fusion power module | 4 × 4 | Fictional power source; authored disabled core, no physical reactor simulation. |
| `utility_battery` | Battery reserve bank | 3 × 2 | Backup power store with separate rack damage zones. |
| `utility_solar` | Deployable solar canopy | 3 × 3 | Power supplement and shaded apron; articulated panel wings. |
| `utility_substation` | Power distribution substation | 2 × 2 | Routes power to zones; reserves maintenance access. |
| `utility_conduit` | Protected utility conduit | 1 × 1 | Power/data path module with visible accessible cover. |
| `utility_junction` | Utility junction box | 1 × 1 | Branch point for power and data routes. |
| `utility_water` | Water purification plant | 3 × 3 | Water supply with intake and service sockets. |
| `utility_tank` | Armored water tank | 2 × 2 | Water buffer; tank shell and support frame are separate components. |
| `utility_cooling` | Cooling and heat-exchange tower | 2 × 2 | Cooling network node for fabrication, servers and power modules. |
| `utility_waste` | Waste reclamation module | 3 × 2 | Waste service endpoint outside the personnel core. |

## Air, orbital and drone operations

| ID | Individual asset | Plot | Function and placement logic |
| --- | --- | --- | --- |
| `air_launchpad` | VTOL launch and landing pad | 8 × 8 | Marked landing surface with a clear approach and overhead volume. |
| `air_pad_extension` | Landing apron extension | 2 × 2 | Expand a pad service apron without expanding its landing clearance. |
| `air_hangar` | Aircraft maintenance hangar | 8 × 6 | Large-door bay matched to a named aircraft envelope. |
| `air_control` | Flight-control tower | 3 × 3 | Pad-facing observation room and communications equipment. |
| `air_drone_pad` | Small drone landing pad | 2 × 2 | Small landing surface with dock/charge sockets. |
| `air_supply_lift` | Orbital cargo transfer platform | 4 × 4 | Fictional cargo receiving lift with an animation-only overhead transfer path. |
| `air_fuel_service` | Sealed flight-service module | 3 × 2 | Abstract service resource tanks and hoses; keep outside landing clearance. |

## Field devices and deployable protection

| ID | Individual asset | Plot | Function and placement logic |
| --- | --- | --- | --- |
| `field_mine_kinetic` | Defensive proximity mine prop | 1 × 1 | Fictional game hazard; closed housing, readable team indicator, no internal mechanism. |
| `field_mine_emp` | EMP pulse mine prop | 1 × 1 | Game-only temporary electronic-disruption effect; distinct ring silhouette. |
| `field_mine_slow` | Gravitic snare mine prop | 1 × 1 | Fictional movement-slowing field emitter; three-prong visual identity. |
| `field_sensor` | Perimeter sensor puck | 1 × 1 | Non-damaging game sensor; shares team/status language with field devices. |
| `field_marker` | Field-device boundary marker | 1 × 1 | Visible marker required by the generator around hazard-designated areas. |
| `field_barrier` | Deployable armored barricade | 1 × 1 | Temporary free-standing cover with a folded transport state. |
| `field_bollard` | Retractable vehicle bollard | 1 × 1 | Checkpoint socket only; lowered state must preserve the road envelope. |
| `field_repair` | Repair drone docking puck | 1 × 1 | Local repair-system service socket, separate from weapon mounts. |
| `field_emergency_power` | Portable emergency power unit | 1 × 1 | Small fictional backup supply for isolated modules. |
| `field_signal` | Deployable relay tripod | 1 × 1 | Temporary data node; folded and deployed articulation states. |

## Identity, interiors and environmental props

| ID | Individual asset | Plot | Function and placement logic |
| --- | --- | --- | --- |
| `prop_lamp` | Area lighting pole | 1 × 1 | Road-edge or courtyard socket; never in a swept vehicle path. |
| `prop_sign` | Directional holographic sign | 1 × 1 | Destructible emitter plus runtime text or hologram. |
| `prop_terminal` | Access and information terminal | 1 × 1 | Wall or floor attachment at entrances. |
| `prop_seating` | Crew bench and table module | 1 × 1 | Personnel common areas only; preserve circulation clearance. |
| `prop_planter` | Sealed bioculture planter | 1 × 1 | Personnel-zone visual relief and life-support storytelling. |
| `prop_vent` | Roof ventilation unit | 1 × 1 | Roof socket only; inherits building support state. |
| `prop_antenna` | Small roof antenna | 1 × 1 | Roof socket only; data connection optional. |
| `prop_banner` | Faction standard and mast | 1 × 1 | Faction identity with destructible mast and cloth sections. |

