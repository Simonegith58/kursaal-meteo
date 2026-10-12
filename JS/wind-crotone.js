(() => {
    'use strict';

    /* ==========================================================
       CROTONE LOCAL GUIDE
       METEO + VENTO + MARE + INDICE PESCA

       Mantiene:
       - ricerca località provincia di Crotone
       - griglia vento dinamica 5x5
       - particelle Canvas
       - meteo integrato
       - previsione 3 giorni
       - selezione giorno / ora
       - click esterno
       - pulsante riapertura
       - desktop / mobile

       Aggiunge:
       - scheda Mare
       - moto ondoso / swell / SST / corrente / livello mare
       - indice pesca costiera indicativo
       ========================================================== */

    if (window.__CROTONE_WIND_INIT__) return;

    if (typeof L === 'undefined') {
        console.warn('[WindCrotone] Leaflet non disponibile.');
        return;
    }

    window.__CROTONE_WIND_INIT__ = true;


    /* ==========================================================
       CONFIG
       ========================================================== */

    const CONFIG = {

        weatherEndpoint:
            '/api/wind-crotone.php',

        marineEndpoint:
            '/api/marine-crotone.php',

                searchEndpoint:
            '/api/search-crotone.php',

        alertsEndpoint:
            '/api/alerts-crotone.php',

        refreshMs:
            10 * 60 * 1000,

        searchDelayMs:
            350,

        visualSpeedFactor:
            6.0,

        frameInterval:
            1000 / 30,

        particleLifeMin:
            35,

        particleLifeMax:
            100,

        defaultZoom:
            13,

        crotoneCenter: {

            name:
                'Crotone',

            label:
                'Crotone',

            lat:
                39.080884,

            lng:
                17.129137

        }

    };


    /* ==========================================================
       STATE
       ========================================================== */

    let map =
        null;

    let canvas =
        null;

    let ctx =
        null;

    let panel =
        null;

    let panelToggleButton =
        null;

    let animationId =
        null;

    let refreshTimer =
        null;

    let searchTimer =
        null;

    let lastFrame =
        0;

    let particles =
        [];


    let dataset =
        null;

    let weather =
        null;

        let marineDataset =
        null;

    let alertDataset =
        null;

    let alertUnavailable =
        false;

    let alertLoading =
        false;


    let selectedFrameId =
    'current';

    let selectedDayDate =
        null;

    /*
     * Giorno "ancora" della selezione.
     * In modalità notte resta, ad esempio, "Oggi"
     * anche quando 00:00 / 03:00 / 06:00 / 09:00
     * appartengono tecnicamente al giorno successivo.
     */
    let selectedDayAnchorDate =
        null;

    /*
     * standard = fasce diurne/serali
     * night    = 20:00, 23:00, 00:00, 03:00, 06:00, 09:00
     */
    let timeMode =
        'standard';

    let activeView =
        'weather';


    let alertDetailsOpen =
        false;


    let active =
        false;

    let loading =
        false;

    let marineLoading =
        false;


    let weatherAbortController =
        null;

    let marineAbortController =
        null;

        let searchAbortController =
        null;

    let alertAbortController =
        null;


    let weatherRequestId =
        0;

    let marineRequestId =
        0;

        let searchRequestId =
        0;

    let alertRequestId =
        0;


    let searchQuery =
        '';


    let currentLocation = {

        ...CONFIG.crotoneCenter

    };


    /* ==========================================================
       HELPERS
       ========================================================== */

    function isMobile() {

        return (

            window.matchMedia(
                '(max-width: 768px)'
            ).matches

            ||

            'ontouchstart'
            in window

        );

    }


    function clamp(
        value,
        min,
        max
    ) {

        return Math.max(
            min,
            Math.min(
                max,
                value
            )
        );

    }


    function finiteOrNull(
        value
    ) {

        const number =
            Number(
                value
            );


        return Number.isFinite(
            number
        )

            ?

            number

            :

            null;

    }



    /* ==========================================================
       ORARI STANDARD / NOTTURNI
       ========================================================== */

    const STANDARD_HOURS = [
        8,
        11,
        14,
        17,
        20,
        23
    ];


    const NIGHT_HOURS = [

        {
            dayOffset: 0,
            hour: 20
        },

        {
            dayOffset: 0,
            hour: 23
        },

        {
            dayOffset: 1,
            hour: 0
        },

        {
            dayOffset: 1,
            hour: 3
        },

        {
            dayOffset: 1,
            hour: 6
        },

        {
            dayOffset: 1,
            hour: 9
        }

    ];


    function getCrotoneHourNow() {

        try {

            const parts =

                new Intl.DateTimeFormat(
                    'en-GB',
                    {
                        timeZone:
                            'Europe/Rome',

                        hour:
                            '2-digit',

                        hour12:
                            false
                    }
                )
                .formatToParts(
                    new Date()
                );


            const hour =

                Number(
                    parts.find(
                        part =>
                            part.type ===
                            'hour'
                    )?.value
                );


            return Number.isFinite(
                hour
            )

                ?

                hour

                :

                new Date()
                    .getHours();


        } catch {

            return new Date()
                .getHours();

        }

    }


    function getDefaultTimeMode() {

        const hour =
            getCrotoneHourNow();


        return (
            hour >= 20
            ||
            hour <= 6
        )

            ?

            'night'

            :

            'standard';

    }


    function slotHourNumber(
        slot
    ) {

        const raw =

            String(
                slot?.hour
                ??
                ''
            )
            .trim();


        const match =

            raw.match(
                /^(\d{1,2})(?::\d{2})?/
            );


        if (match) {

            const hour =
                Number(
                    match[1]
                );


            return (
                Number.isInteger(
                    hour
                )
                &&
                hour >= 0
                &&
                hour <= 23
            )

                ?

                hour

                :

                null;

        }


        const time =

            String(
                slot?.time
                ??
                ''
            )
            .trim();


        const timeMatch =

            time.match(
                /T(\d{2}):/
            );


        if (timeMatch) {

            const hour =
                Number(
                    timeMatch[1]
                );


            return Number.isInteger(
                hour
            )

                ?

                hour

                :

                null;

        }


        return null;

    }


    function addDaysToDate(
        date,
        days
    ) {

        if (!date) {

            return null;

        }


        const value =

            new Date(
                `${date}T00:00:00Z`
            );


        if (
            Number.isNaN(
                value.getTime()
            )
        ) {

            return null;

        }


        value.setUTCDate(

            value.getUTCDate()

            +

            Number(
                days
                ||
                0
            )

        );


        return value
            .toISOString()
            .slice(
                0,
                10
            );

    }



    function directionLabel(
        degrees
    ) {

        if (
            !Number.isFinite(
                degrees
            )
        ) {

            return '—';

        }


        const labels = [

            'N',
            'NNE',
            'NE',
            'ENE',

            'E',
            'ESE',
            'SE',
            'SSE',

            'S',
            'SSO',
            'SO',
            'OSO',

            'O',
            'ONO',
            'NO',
            'NNO'

        ];


        return labels[

            Math.round(
                degrees / 22.5
            ) % 16

        ];

    }


    /* ==========================================================
       WEATHER CODE
       ========================================================== */

    function weatherDescriptor(
        code,
        isDay = 1
    ) {

        const c =
            Number(
                code
            );


        const day =
            Number(
                isDay
            ) !== 0;


        if (
            c === 0
        ) {

            return {

                icon:
                    day
                        ? '☀️'
                        : '🌙',

                label:
                    'Sereno'

            };

        }


        if (
            c === 1
        ) {

            return {

                icon:
                    day
                        ? '🌤️'
                        : '🌙',

                label:
                    'Prevalentemente sereno'

            };

        }


        if (
            c === 2
        ) {

            return {

                icon:
                    '⛅',

                label:
                    'Parzialmente nuvoloso'

            };

        }


        if (
            c === 3
        ) {

            return {

                icon:
                    '☁️',

                label:
                    'Coperto'

            };

        }


        if (
            c === 45
            ||
            c === 48
        ) {

            return {

                icon:
                    '🌫️',

                label:
                    'Nebbia'

            };

        }


        if (
            [51, 53, 55, 56, 57]
                .includes(
                    c
                )
        ) {

            return {

                icon:
                    '🌦️',

                label:
                    'Pioviggine'

            };

        }


        if (
            [61, 63, 65, 66, 67]
                .includes(
                    c
                )
        ) {

            return {

                icon:
                    '🌧️',

                label:
                    'Pioggia'

            };

        }


        if (
            [71, 73, 75, 77]
                .includes(
                    c
                )
        ) {

            return {

                icon:
                    '🌨️',

                label:
                    'Neve'

            };

        }


        if (
            [80, 81, 82]
                .includes(
                    c
                )
        ) {

            return {

                icon:
                    '🌦️',

                label:
                    'Rovesci'

            };

        }


        if (
            [85, 86]
                .includes(
                    c
                )
        ) {

            return {

                icon:
                    '🌨️',

                label:
                    'Rovesci di neve'

            };

        }


        if (
            [95, 96, 99]
                .includes(
                    c
                )
        ) {

            return {

                icon:
                    '⛈️',

                label:

                    c >= 96

                        ?

                        'Temporale con grandine'

                        :

                        'Temporale'

            };

        }


        return {

            icon:
                '🌡️',

            label:
                'Condizioni meteo'

        };

    }


    /* ==========================================================
       VETTORE VENTO
       ========================================================== */

    function weatherVector(
        speedKmh,
        directionFrom
    ) {

        const speedMs =

            Number(
                speedKmh
            )

            /

            3.6;


        const radians =

            Number(
                directionFrom
            )

            *

            Math.PI

            /

            180;


        return {

            u:

                -speedMs
                *
                Math.sin(
                    radians
                ),


            v:

                -speedMs
                *
                Math.cos(
                    radians
                )

        };

    }


    /* ==========================================================
       NORMALIZE WEATHER FRAME
       ========================================================== */

    function normalizeFrame(
        raw,
        rows,
        cols,
        bounds
    ) {

        if (

            !raw

            ||

            !Array.isArray(
                raw.points
            )

        ) {

            return null;

        }


        const matrix =

            Array.from(

                {
                    length:
                        rows
                },

                () =>
                    Array(
                        cols
                    ).fill(
                        null
                    )

            );


        for (
            const point
            of raw.points
        ) {

            const row =
                Number(
                    point.row
                );


            const col =
                Number(
                    point.col
                );


            const speed =
                Number(
                    point.speedKmh
                );


            const direction =
                Number(
                    point.directionFrom
                );


            if (

                !Number.isInteger(
                    row
                )

                ||

                !Number.isInteger(
                    col
                )

                ||

                row < 0

                ||

                row >= rows

                ||

                col < 0

                ||

                col >= cols

                ||

                !Number.isFinite(
                    speed
                )

                ||

                !Number.isFinite(
                    direction
                )

            ) {

                continue;

            }


            const vector =

                weatherVector(
                    speed,
                    direction
                );


            const gust =
                Number(
                    point.gustKmh
                );


            matrix[
                row
            ][
                col
            ] = {

                speedKmh:
                    speed,

                directionFrom:
                    direction,

                gustKmh:

                    Number.isFinite(
                        gust
                    )

                        ?

                        gust

                        :

                        speed,

                u:
                    vector.u,

                v:
                    vector.v,


                temperatureC:

                    finiteOrNull(
                        point.temperatureC
                    ),


                apparentTemperatureC:

                    finiteOrNull(
                        point.apparentTemperatureC
                    ),


                humidityPct:

                    finiteOrNull(
                        point.humidityPct
                    ),


                precipitationProbabilityPct:

                    finiteOrNull(
                        point.precipitationProbabilityPct
                    ),


                precipitationMm:

                    finiteOrNull(
                        point.precipitationMm
                    ),


                rainMm:

                    finiteOrNull(
                        point.rainMm
                    ),


                showersMm:

                    finiteOrNull(
                        point.showersMm
                    ),


                snowfallCm:

                    finiteOrNull(
                        point.snowfallCm
                    ),


                cloudCoverPct:

                    finiteOrNull(
                        point.cloudCoverPct
                    ),


                pressureMslHpa:

                    finiteOrNull(
                        point.pressureMslHpa
                    ),


                weatherCode:

                    finiteOrNull(
                        point.weatherCode
                    ),


                isDay:

                    finiteOrNull(
                        point.isDay
                    )

            };

        }


        return {

            id:
                raw.id
                ||
                raw.time
                ||
                'current',

            time:
                raw.time
                ||
                null,

            hour:
                raw.hour
                ||
                null,

            date:
                raw.date
                ||
                null,

            rows,

            cols,

            bounds,

            matrix

        };

    }


    /* ==========================================================
       NORMALIZE WEATHER DATASET
       ========================================================== */

    function normalizeDataset(
        data
    ) {

        if (

            !data

            ||

            data.ok !== true

            ||

            !data.current

            ||

            !Array.isArray(
                data.days
            )

        ) {

            throw new Error(
                'Formato dati meteo non valido'
            );

        }


        const rows =
            Number(
                data.rows
            );


        const cols =
            Number(
                data.cols
            );


        if (

            !Number.isInteger(
                rows
            )

            ||

            !Number.isInteger(
                cols
            )

            ||

            rows < 2

            ||

            cols < 2

        ) {

            throw new Error(
                'Griglia meteo non valida'
            );

        }


        const bounds = {

            south:
                Number(
                    data.bounds?.south
                ),

            north:
                Number(
                    data.bounds?.north
                ),

            west:
                Number(
                    data.bounds?.west
                ),

            east:
                Number(
                    data.bounds?.east
                )

        };


        const current =

            normalizeFrame(

                {

                    ...data.current,

                    id:
                        'current'

                },

                rows,

                cols,

                bounds

            );


        if (!current) {

            throw new Error(
                'Dati correnti non disponibili'
            );

        }


        const frames =
            new Map();


        const days =
            [];


        frames.set(
            'current',
            current
        );


        for (
            const rawDay
            of data.days
        ) {

            const day = {

                date:
                    String(
                        rawDay.date
                        ||
                        ''
                    ),

                dayOffset:
                    Number(
                        rawDay.dayOffset
                    ),

                slots:
                    []

            };


            if (
                !day.date
            ) {

                continue;

            }


            for (
                const rawSlot
                of (
                    rawDay.slots
                    ||
                    []
                )
            ) {

                const id =
                    String(
                        rawSlot.time
                    );


                const slot =

                    normalizeFrame(

                        {

                            ...rawSlot,

                            id,

                            date:
                                day.date

                        },

                        rows,

                        cols,

                        bounds

                    );


                if (!slot) {

                    continue;

                }


                frames.set(
                    id,
                    slot
                );


                day.slots.push(
                    slot
                );

            }


            days.push(
                day
            );

        }


        days.sort(
            (
                a,
                b
            ) =>
                a.dayOffset
                -
                b.dayOffset
        );


        return {

            source:
                data.source
                ||
                'Open-Meteo',

            stale:
                data.stale === true,

            center:
                data.center
                ||
                null,

            current,

            days,

            frames

        };

    }


    /* ==========================================================
       NORMALIZE MARINE FRAME
       ========================================================== */

    function normalizeMarineFrame(
        raw
    ) {

        if (
            !raw

            ||

            typeof raw !==
                'object'
        ) {

            return null;

        }


        return {

            time:
                raw.time
                ||
                null,


            waveHeightM:

                finiteOrNull(
                    raw.waveHeightM
                ),


            waveDirectionFrom:

                finiteOrNull(
                    raw.waveDirectionFrom
                ),


            wavePeriodS:

                finiteOrNull(
                    raw.wavePeriodS
                ),


            wavePeakPeriodS:

                finiteOrNull(
                    raw.wavePeakPeriodS
                ),


            windWaveHeightM:

                finiteOrNull(
                    raw.windWaveHeightM
                ),


            windWaveDirectionFrom:

                finiteOrNull(
                    raw.windWaveDirectionFrom
                ),


            windWavePeriodS:

                finiteOrNull(
                    raw.windWavePeriodS
                ),


            swellWaveHeightM:

                finiteOrNull(
                    raw.swellWaveHeightM
                ),


            swellWaveDirectionFrom:

                finiteOrNull(
                    raw.swellWaveDirectionFrom
                ),


            swellWavePeriodS:

                finiteOrNull(
                    raw.swellWavePeriodS
                ),


            swellWavePeakPeriodS:

                finiteOrNull(
                    raw.swellWavePeakPeriodS
                ),


            seaSurfaceTemperatureC:

                finiteOrNull(
                    raw.seaSurfaceTemperatureC
                ),


            oceanCurrentVelocityKmh:

                finiteOrNull(
                    raw.oceanCurrentVelocityKmh
                ),


            oceanCurrentDirectionTo:

                finiteOrNull(
                    raw.oceanCurrentDirectionTo
                ),


            seaLevelHeightMslM:

                finiteOrNull(
                    raw.seaLevelHeightMslM
                )

        };

    }


    /* ==========================================================
       NORMALIZE MARINE DATASET
       ========================================================== */

    function normalizeMarineDataset(
        data
    ) {

        if (

            !data

            ||

            data.ok !== true

        ) {

            throw new Error(
                'Formato dati marini non valido'
            );

        }


        const frames =
            new Map();


        for (
            const [
                time,
                raw
            ]
            of Object.entries(
                data.frames
                ||
                {}
            )
        ) {

            const frame =

                normalizeMarineFrame(
                    raw
                );


            if (
                frame
            ) {

                frames.set(
                    time,
                    frame
                );

            }

        }


        return {

            source:
                data.source
                ||
                'Open-Meteo Marine',

            stale:
                data.stale === true,

            available:
                data.available === true,

            marinePoint:
                data.marinePoint
                ||
                null,

            maxAcceptedDistanceKm:

                finiteOrNull(
                    data.maxAcceptedDistanceKm
                ),

            current:

                normalizeMarineFrame(
                    data.current
                ),

            frames

        };

    }


    /* ==========================================================
       INTERPOLAZIONE
       ========================================================== */

    function mix(
        a,
        b,
        t
    ) {

        return (

            a

            +

            (
                b - a
            )

            *

            t

        );

    }


    function getInterpolationCell(
        lat,
        lng
    ) {

        if (!weather) {

            return null;

        }


        const {

            south,
            north,
            west,
            east

        } =
            weather.bounds;


        if (

            lat < south

            ||

            lat > north

            ||

            lng < west

            ||

            lng > east

        ) {

            return null;

        }


        const gx =

            (
                (lng - west)
                /
                (east - west)
            )

            *

            (
                weather.cols - 1
            );


        const gy =

            (
                (lat - south)
                /
                (north - south)
            )

            *

            (
                weather.rows - 1
            );


        let col0 =
            Math.floor(
                gx
            );


        let row0 =
            Math.floor(
                gy
            );


        col0 =

            clamp(
                col0,
                0,
                weather.cols - 2
            );


        row0 =

            clamp(
                row0,
                0,
                weather.rows - 2
            );


        const col1 =
            col0 + 1;


        const row1 =
            row0 + 1;


        const tx =

            clamp(
                gx - col0,
                0,
                1
            );


        const ty =

            clamp(
                gy - row0,
                0,
                1
            );


        const p00 =
            weather.matrix[
                row0
            ][
                col0
            ];


        const p10 =
            weather.matrix[
                row0
            ][
                col1
            ];


        const p01 =
            weather.matrix[
                row1
            ][
                col0
            ];


        const p11 =
            weather.matrix[
                row1
            ][
                col1
            ];


        if (

            !p00

            ||

            !p10

            ||

            !p01

            ||

            !p11

        ) {

            return null;

        }


        return {

            gx,
            gy,

            row0,
            row1,

            col0,
            col1,

            tx,
            ty,

            p00,
            p10,
            p01,
            p11

        };

    }


    /* ==========================================================
       SAMPLE WIND
       ========================================================== */

    function sampleWind(
        lat,
        lng
    ) {

        const cell =

            getInterpolationCell(
                lat,
                lng
            );


        if (!cell) {

            return null;

        }


        const {

            p00,
            p10,
            p01,
            p11,
            tx,
            ty

        } =
            cell;


        const u =

            mix(

                mix(
                    p00.u,
                    p10.u,
                    tx
                ),

                mix(
                    p01.u,
                    p11.u,
                    tx
                ),

                ty

            );


        const v =

            mix(

                mix(
                    p00.v,
                    p10.v,
                    tx
                ),

                mix(
                    p01.v,
                    p11.v,
                    tx
                ),

                ty

            );


        const speedMs =

            Math.sqrt(
                u * u
                +
                v * v
            );


        let direction =

            Math.atan2(
                -u,
                -v
            )

            *

            180

            /

            Math.PI;


        direction =

            (
                direction
                +
                360
            )

            %

            360;


        const gust =

            mix(

                mix(
                    p00.gustKmh,
                    p10.gustKmh,
                    tx
                ),

                mix(
                    p01.gustKmh,
                    p11.gustKmh,
                    tx
                ),

                ty

            );


        return {

            u,

            v,

            speedKmh:
                speedMs
                *
                3.6,

            directionFrom:
                direction,

            gustKmh:
                gust

        };

    }


    /* ==========================================================
       SAMPLE ATMOSPHERE
       ========================================================== */

    function sampleAtmosphere(
        lat,
        lng
    ) {

        const cell =

            getInterpolationCell(
                lat,
                lng
            );


        if (!cell) {

            return null;

        }


        const {

            p00,
            p10,
            p01,
            p11,
            tx,
            ty,
            gx,
            gy

        } =
            cell;


        function interpolateField(
            key
        ) {

            const values = [

                p00[key],
                p10[key],
                p01[key],
                p11[key]

            ];


            if (
                values.every(
                    Number.isFinite
                )
            ) {

                return mix(

                    mix(
                        values[0],
                        values[1],
                        tx
                    ),

                    mix(
                        values[2],
                        values[3],
                        tx
                    ),

                    ty

                );

            }


            return (

                values.find(
                    Number.isFinite
                )

                ??

                null

            );

        }


        const nearestRow =

            clamp(
                Math.round(
                    gy
                ),
                0,
                weather.rows - 1
            );


        const nearestCol =

            clamp(
                Math.round(
                    gx
                ),
                0,
                weather.cols - 1
            );


        const nearest =

            weather.matrix[
                nearestRow
            ][
                nearestCol
            ]

            ||

            p00;


        return {

            temperatureC:

                interpolateField(
                    'temperatureC'
                ),


            apparentTemperatureC:

                interpolateField(
                    'apparentTemperatureC'
                ),


            humidityPct:

                interpolateField(
                    'humidityPct'
                ),


            precipitationProbabilityPct:

                interpolateField(
                    'precipitationProbabilityPct'
                ),


            precipitationMm:

                interpolateField(
                    'precipitationMm'
                ),


            rainMm:

                interpolateField(
                    'rainMm'
                ),


            showersMm:

                interpolateField(
                    'showersMm'
                ),


            snowfallCm:

                interpolateField(
                    'snowfallCm'
                ),


            cloudCoverPct:

                interpolateField(
                    'cloudCoverPct'
                ),


            pressureMslHpa:

                interpolateField(
                    'pressureMslHpa'
                ),


            weatherCode:

                nearest
                    ?.weatherCode

                ??

                null,


            isDay:

                nearest
                    ?.isDay

                ??

                1

        };

    }


    /* ==========================================================
       FRAME MARINO SELEZIONATO
       ========================================================== */

    function getSelectedMarineFrame() {

        if (

            !marineDataset

            ||

            !marineDataset.available

        ) {

            return null;

        }


        if (
            selectedFrameId ===
                'current'
        ) {

            return marineDataset.current;

        }


        return (

            marineDataset.frames.get(
                selectedFrameId
            )

            ||

            null

        );

    }


    /* ==========================================================
       CANVAS
       ========================================================== */

    function metersPerPixel(
        lat
    ) {

        return (

            156543.03392

            *

            Math.cos(
                lat
                *
                Math.PI
                /
                180
            )

            /

            Math.pow(
                2,
                map.getZoom()
            )

        );

    }


    function createCanvas() {

        if (canvas) {

            return;

        }


        canvas =
            document.createElement(
                'canvas'
            );


        canvas.className =
            'wind-crotone-canvas';


        canvas.setAttribute(
            'aria-hidden',
            'true'
        );


        map
            .getContainer()
            .appendChild(
                canvas
            );


        ctx =

            canvas.getContext(
                '2d',
                {
                    alpha:
                        true
                }
            );


        resizeCanvas();

    }


    function resizeCanvas() {

        if (

            !canvas

            ||

            !ctx

            ||

            !map

        ) {

            return;

        }


        const size =
            map.getSize();


        const dpr =

            Math.min(
                window.devicePixelRatio
                ||
                1,
                2
            );


        canvas.width =

            Math.max(
                1,
                Math.round(
                    size.x
                    *
                    dpr
                )
            );


        canvas.height =

            Math.max(
                1,
                Math.round(
                    size.y
                    *
                    dpr
                )
            );


        canvas.style.width =
            `${size.x}px`;


        canvas.style.height =
            `${size.y}px`;


        ctx.setTransform(
            dpr,
            0,
            0,
            dpr,
            0,
            0
        );


        initParticles();

    }


    /* ==========================================================
       PARTICELLE
       ========================================================== */

    function particleCount() {

        const size =
            map.getSize();


        const area =
            size.x
            *
            size.y;


        if (
            isMobile()
        ) {

            return Math.max(

                100,

                Math.min(
                    280,
                    Math.round(
                        area
                        *
                        0.00038
                    )
                )

            );

        }


        return Math.max(

            180,

            Math.min(
                650,
                Math.round(
                    area
                    *
                    0.00060
                )
            )

        );

    }


    function randomLife() {

        return (

            CONFIG.particleLifeMin

            +

            Math.random()

            *

            (
                CONFIG.particleLifeMax
                -
                CONFIG.particleLifeMin
            )

        );

    }


    function resetParticle(
        particle,
        randomAge = false
    ) {

        if (

            !map

            ||

            !weather

        ) {

            return;

        }


        const width =
            map.getSize().x;


        const height =
            map.getSize().y;


        for (
            let attempt = 0;
            attempt < 15;
            attempt++
        ) {

            const x =
                Math.random()
                *
                width;


            const y =
                Math.random()
                *
                height;


            const latlng =

                map.containerPointToLatLng(

                    L.point(
                        x,
                        y
                    )

                );


            if (
                sampleWind(
                    latlng.lat,
                    latlng.lng
                )
            ) {

                particle.x =
                    x;


                particle.y =
                    y;


                particle.age =

                    randomAge

                        ?

                        Math.random()
                        *
                        randomLife()

                        :

                        0;


                particle.maxAge =
                    randomLife();


                return;

            }

        }


        particle.age =
            0;


        particle.maxAge =
            0;

    }


    function initParticles() {

        if (

            !map

            ||

            !weather

        ) {

            particles =
                [];

            return;

        }


        particles =

            Array.from(

                {
                    length:
                        particleCount()
                },

                () => {

                    const particle = {

                        x:
                            0,

                        y:
                            0,

                        age:
                            0,

                        maxAge:
                            randomLife()

                    };


                    resetParticle(
                        particle,
                        true
                    );


                    return particle;

                }

            );

    }


    function clearCanvas() {

        if (

            !ctx

            ||

            !map

        ) {

            return;

        }


        const size =
            map.getSize();


        ctx.clearRect(
            0,
            0,
            size.x,
            size.y
        );

    }


    /* ==========================================================
       ANIMAZIONE
       ========================================================== */

    function animate(
        timestamp
    ) {

        if (

            !active

            ||

            !ctx

            ||

            !weather

        ) {

            animationId =
                null;

            return;

        }


        animationId =

            requestAnimationFrame(
                animate
            );


        const elapsed =
            timestamp
            -
            lastFrame;


        if (
            elapsed <
            CONFIG.frameInterval
        ) {

            return;

        }


        lastFrame =
            timestamp;


        const dt =

            Math.min(
                elapsed / 1000,
                0.06
            );


        const size =
            map.getSize();


        ctx.save();


        ctx.globalCompositeOperation =
            'destination-in';


        ctx.fillStyle =
            'rgba(0,0,0,.925)';


        ctx.fillRect(
            0,
            0,
            size.x,
            size.y
        );


        ctx.restore();


        const color =

            getComputedStyle(
                canvas
            )

            .getPropertyValue(
                '--wind-particle-color'
            )

            .trim()

            ||

            'rgba(225,245,255,.88)';


        ctx.save();


        ctx.globalCompositeOperation =
            'source-over';


        ctx.strokeStyle =
            color;


        ctx.lineWidth =

            isMobile()

                ?

                1

                :

                1.2;


        ctx.lineCap =
            'round';


        ctx.beginPath();


        for (
            const particle
            of particles
        ) {

            particle.age++;


            if (

                particle.age >
                    particle.maxAge

                ||

                particle.x < 0

                ||

                particle.y < 0

                ||

                particle.x > size.x

                ||

                particle.y > size.y

            ) {

                resetParticle(
                    particle
                );

                continue;

            }


            const latlng =

                map.containerPointToLatLng(

                    L.point(
                        particle.x,
                        particle.y
                    )

                );


            const wind =

                sampleWind(
                    latlng.lat,
                    latlng.lng
                );


            if (!wind) {

                resetParticle(
                    particle
                );

                continue;

            }


            const resolution =

                metersPerPixel(
                    latlng.lat
                );


            if (

                !Number.isFinite(
                    resolution
                )

                ||

                resolution <= 0

            ) {

                resetParticle(
                    particle
                );

                continue;

            }


            const dx =

                (
                    wind.u
                    /
                    resolution
                )

                *

                CONFIG.visualSpeedFactor

                *

                dt;


            const dy =

                (
                    -wind.v
                    /
                    resolution
                )

                *

                CONFIG.visualSpeedFactor

                *

                dt;


            const oldX =
                particle.x;


            const oldY =
                particle.y;


            particle.x +=
                dx;


            particle.y +=
                dy;


            ctx.moveTo(
                oldX,
                oldY
            );


            ctx.lineTo(
                particle.x,
                particle.y
            );

        }


        ctx.stroke();


        ctx.restore();

    }


    function startAnimation() {

        stopAnimation();


        if (

            !active

            ||

            !weather

        ) {

            return;

        }


        lastFrame =
            performance.now();


        animationId =

            requestAnimationFrame(
                animate
            );

    }


    function stopAnimation() {

        if (
            animationId !== null
        ) {

            cancelAnimationFrame(
                animationId
            );


            animationId =
                null;

        }


        clearCanvas();

    }


    /* ==========================================================
       GIORNI
       ========================================================== */

    function formatDayLabel(
        day
    ) {

        if (
            day.dayOffset === 0
        ) {

            return 'Oggi';

        }


        if (
            day.dayOffset === 1
        ) {

            return 'Domani';

        }


        try {

            return new Intl.DateTimeFormat(
                'it-IT',
                {
                    weekday:
                        'short',

                    day:
                        'numeric'
                }
            )
            .format(
                new Date(
                    `${day.date}T12:00:00`
                )
            )
            .replace(
                '.',
                ''
            );


        } catch {

            return day.date;

        }

    }


    function getDay(
        date
    ) {

        return (

            dataset
                ?.days
                .find(
                    day =>
                        day.date ===
                        date
                )

            ||

            null

        );

    }


        /* ==========================================================
       FRAME
       ========================================================== */

    function getVisibleDays() {

        return (

            dataset
                ?.days

            ||

            []

        )
        .filter(
            day =>

                day.dayOffset >= 0

                &&

                day.dayOffset <= 2
        )
        .slice(
            0,
            3
        );

    }


    function getStandardSlots(
        day
    ) {

        if (!day) {

            return [];

        }


        return day.slots.filter(
            slot =>

                STANDARD_HOURS.includes(
                    slotHourNumber(
                        slot
                    )
                )
        );

    }


    function findSlot(
        date,
        hour
    ) {

        const day =
            getDay(
                date
            );


        if (!day) {

            return null;

        }


        return (

            day.slots.find(
                slot =>

                    slotHourNumber(
                        slot
                    )

                    ===

                    Number(
                        hour
                    )
            )

            ||

            null

        );

    }


    function getNightEntries(
        anchorDate =
            selectedDayAnchorDate
            ||
            selectedDayDate
    ) {

        if (!anchorDate) {

            return [];

        }


        return NIGHT_HOURS.map(
            item => {

                const date =

                    addDaysToDate(
                        anchorDate,
                        item.dayOffset
                    );


                const sourceDay =
                    getDay(
                        date
                    );


                const slot =

                    findSlot(
                        date,
                        item.hour
                    );


                return {

                    date,

                    sourceDay,

                    slot,

                    nextDay:
                        item.dayOffset > 0,

                    hour:
                        item.hour,

                    label:
                        `${
                            String(
                                item.hour
                            )
                            .padStart(
                                2,
                                '0'
                            )
                        }:00`

                };

            }
        );

    }


    function selectFrame(
        id,
        options = {}
    ) {

        if (

            !dataset

            ||

            !dataset.frames.has(
                id
            )

        ) {

            return;

        }


        const preserveAnchor =
            options.preserveAnchor ===
            true;


        selectedFrameId =
            id;


        weather =

            dataset.frames.get(
                id
            );


        if (

            id !==
                'current'

            &&

            weather.date

        ) {

            selectedDayDate =
                weather.date;


            if (
                !preserveAnchor
            ) {

                selectedDayAnchorDate =
                    weather.date;

            }

        }


        if (

            id ===
                'current'

            &&

            !preserveAnchor

        ) {

            selectedDayAnchorDate =
                selectedDayDate;

        }


        stopAnimation();

        initParticles();

        updatePanel();


        if (active) {

            startAnimation();

        }

    }


    function chooseFirstStandardFrame(
        day
    ) {

        if (!day) {

            return false;

        }


        if (
            day.dayOffset ===
                0
        ) {

            selectFrame(
                'current',
                {
                    preserveAnchor:
                        true
                }
            );


            return true;

        }


        const slot =

            getStandardSlots(
                day
            )[0]

            ||

            day.slots[0]

            ||

            null;


        if (slot) {

            selectFrame(
                slot.id,
                {
                    preserveAnchor:
                        true
                }
            );


            return true;

        }


        return false;

    }


    function chooseFirstNightFrame(
        anchorDate
    ) {

        const entry =

            getNightEntries(
                anchorDate
            )
            .find(
                item =>
                    item.slot
            );


        if (
            !entry
            ||
            !entry.slot
        ) {

            return false;

        }


        selectFrame(
            entry.slot.id,
            {
                preserveAnchor:
                    true
            }
        );


        return true;

    }


    function setTimeMode(
        newMode
    ) {

        const normalized =

            newMode ===
                'night'

                ?

                'night'

                :

                'standard';


        if (
            timeMode ===
                normalized
        ) {

            updatePanel();

            return;

        }


        timeMode =
            normalized;


        if (

            !dataset

            ||

            !weather

        ) {

            updatePanel();

            return;

        }


        const anchorDate =

            selectedDayAnchorDate

            ||

            selectedDayDate

            ||

            getVisibleDays()[0]?.date

            ||

            null;


        selectedDayAnchorDate =
            anchorDate;


        if (
            timeMode ===
                'night'
        ) {

            const selectedIsAlreadyNight =

                getNightEntries(
                    anchorDate
                )
                .some(
                    entry =>

                        entry.slot?.id ===
                        selectedFrameId
                );


            if (
                !selectedIsAlreadyNight
            ) {

                if (
                    chooseFirstNightFrame(
                        anchorDate
                    )
                ) {

                    return;

                }

            }


            updatePanel();

            return;

        }


        const anchorDay =
            getDay(
                anchorDate
            );


        const selectedIsStandard =

            weather?.date ===
                anchorDate

            &&

            STANDARD_HOURS.includes(
                slotHourNumber(
                    weather
                )
            );


        if (
            !selectedIsStandard
            &&
            selectedFrameId !==
                'current'
        ) {

            if (
                chooseFirstStandardFrame(
                    anchorDay
                )
            ) {

                return;

            }

        }


        updatePanel();

    }


   function selectDay(
    date
) {

    const day =
        getDay(
            date
        );


    if (!day) {

        return;

    }


    selectedDayAnchorDate =
        date;


    selectedDayDate =
        date;


    if (
        timeMode ===
            'night'
    ) {

        if (
            chooseFirstNightFrame(
                date
            )
        ) {

            return;

        }


        /*
         * Nessun frame notte disponibile:
         * aggiorna comunque visivamente
         * il giorno selezionato.
         */
        updatePanel();

        return;

    }


    chooseFirstStandardFrame(
        day
    );

}




    /* ==========================================================
       SEARCH
       ========================================================== */

    function clearSearchTimer() {

        if (
            searchTimer !== null
        ) {

            clearTimeout(
                searchTimer
            );


            searchTimer =
                null;

        }

    }


    async function performLocationSearch(
        text,
        resultsContainer
    ) {

        const term =

            String(
                text
            )
            .trim();


        if (
            term.length < 2
        ) {

            resultsContainer
                .replaceChildren();


            resultsContainer
                .classList
                .remove(
                    'is-visible'
                );


            return;

        }


        searchAbortController
            ?.abort();
            
            
        alertDetailsOpen =
            false;


        searchAbortController =
            new AbortController();


        const requestId =
            ++searchRequestId;


        resultsContainer
            .replaceChildren();


        const loadingRow =
            document.createElement(
                'div'
            );


        loadingRow.className =
            'wind-crotone-search-status';


        loadingRow.textContent =
            'Ricerca…';


        resultsContainer
            .appendChild(
                loadingRow
            );


        resultsContainer
            .classList
            .add(
                'is-visible'
            );


        try {

            const url =

                `${CONFIG.searchEndpoint}?q=${
                    encodeURIComponent(
                        term
                    )
                }`;


            const response =

                await fetch(
                    url,
                    {

                        headers: {

                            Accept:
                                'application/json'

                        },

                        cache:
                            'no-store',

                        signal:
                            searchAbortController.signal

                    }
                );


            if (!response.ok) {

                throw new Error(
                    `HTTP ${response.status}`
                );

            }


            const data =
                await response.json();


            if (
                requestId !==
                searchRequestId
            ) {

                return;

            }


            if (

                !panel

                ||

                !panel.contains(
                    resultsContainer
                )

            ) {

                return;

            }


            resultsContainer
                .replaceChildren();


            const results =

                Array.isArray(
                    data.results
                )

                    ?

                    data.results

                    :

                    [];


            if (
                results.length === 0
            ) {

                const empty =
                    document.createElement(
                        'div'
                    );


                empty.className =
                    'wind-crotone-search-status';


                empty.textContent =
                    'Nessuna località trovata nella provincia di Crotone';


                resultsContainer
                    .appendChild(
                        empty
                    );


                return;

            }


            for (
                const result
                of results
            ) {

                const button =
                    document.createElement(
                        'button'
                    );


                button.type =
                    'button';


                button.className =
                    'wind-crotone-search-result';


                const name =
                    document.createElement(
                        'strong'
                    );


                name.textContent =
                    result.name;


                const detail =
                    document.createElement(
                        'small'
                    );


                detail.textContent =

                    result.label !==
                    result.name

                        ?

                        result.label.replace(
                            `${result.name} · `,
                            ''
                        )

                        :

                        'Provincia di Crotone';


                button.append(
                    name,
                    detail
                );


                button.addEventListener(
                    'pointerdown',
                    event => {

                        event.stopPropagation();

                    }
                );


                button.addEventListener(
                    'click',
                    event => {

                        event.preventDefault();

                        event.stopPropagation();


                        selectLocation(
                            result
                        );

                    }
                );


                resultsContainer
                    .appendChild(
                        button
                    );

            }


        } catch (
            error
        ) {

            if (
                error?.name ===
                'AbortError'
            ) {

                return;

            }


            console.error(
                '[WindCrotone Search]',
                error
            );


            if (

                panel

                &&

                panel.contains(
                    resultsContainer
                )

            ) {

                resultsContainer
                    .replaceChildren();


                const errorRow =
                    document.createElement(
                        'div'
                    );


                errorRow.className =
                    'wind-crotone-search-status';


                errorRow.textContent =
                    'Ricerca non disponibile';


                resultsContainer
                    .appendChild(
                        errorRow
                    );

            }

        }

    }


    /* ==========================================================
       CAMBIO LOCALITÀ
       ========================================================== */

    function selectLocation(
        result
    ) {

        const lat =
            Number(
                result.lat
            );


        const lng =
            Number(
                result.lng
            );


        if (

            !Number.isFinite(
                lat
            )

            ||

            !Number.isFinite(
                lng
            )

        ) {

            return;

        }


        currentLocation = {

            name:
                String(
                    result.name
                    ||
                    'Località'
                ),

            label:
                String(
                    result.label
                    ||
                    result.name
                    ||
                    'Località'
                ),

            lat,

            lng

        };


        searchQuery =
            '';


        clearSearchTimer();


        searchAbortController
            ?.abort();


               selectedFrameId =
            'current';


        selectedDayDate =
            null;


        selectedDayAnchorDate =
            null;


        timeMode =
            getDefaultTimeMode();


        dataset =
            null;


        weather =
            null;


        marineDataset =
            null;


        particles =
            [];


        stopAnimation();


        updatePanelLoading();


        const targetZoom =

            Math.min(
                14,
                Math.max(
                    12,
                    map.getZoom()
                )
            );


        map.flyTo(
            [
                lat,
                lng
            ],
            targetZoom,
            {
                animate:
                    true,

                duration:
                    0.75
            }
        );


        loadWeather(
            {
                resetSelection:
                    true
            }
        );


        loadMarine();

    }


    /* ==========================================================
       SEARCH BOX
       ========================================================== */

    function buildSearchBox() {

        const wrapper =
            document.createElement(
                'div'
            );


        wrapper.className =
            'wind-crotone-search';


        const row =
            document.createElement(
                'div'
            );


        row.className =
            'wind-crotone-search-row';


        const input =
            document.createElement(
                'input'
            );


        input.type =
            'search';


        input.className =
            'wind-crotone-search-input';


        input.placeholder =
            'Cerca località…';


        input.value =
            searchQuery;


        input.autocomplete =
            'off';


        input.spellcheck =
            false;


        input.setAttribute(
            'aria-label',
            'Cerca località nella provincia di Crotone'
        );


        const searchButton =
            document.createElement(
                'button'
            );


        searchButton.type =
            'button';


        searchButton.className =
            'wind-crotone-search-btn';


        searchButton.textContent =
            '⌕';


        searchButton.title =
            'Cerca località';


        const results =
            document.createElement(
                'div'
            );


        results.className =
            'wind-crotone-search-results';


        input.addEventListener(
            'pointerdown',
            event => {

                event.stopPropagation();

            }
        );


        input.addEventListener(
            'input',
            event => {

                searchQuery =
                    event.target.value;


                clearSearchTimer();


                if (

                    searchQuery
                        .trim()
                        .length
                    <
                    2

                ) {

                    results
                        .replaceChildren();


                    results
                        .classList
                        .remove(
                            'is-visible'
                        );


                    return;

                }


                searchTimer =

                    setTimeout(
                        () => {

                            performLocationSearch(
                                searchQuery,
                                results
                            );

                        },
                        CONFIG.searchDelayMs
                    );

            }
        );


        input.addEventListener(
            'keydown',
            event => {

                if (
                    event.key !==
                        'Enter'
                ) {

                    return;

                }


                event.preventDefault();

                event.stopPropagation();


                clearSearchTimer();


                performLocationSearch(
                    input.value,
                    results
                );

            }
        );


        searchButton.addEventListener(
            'pointerdown',
            event => {

                event.preventDefault();

                event.stopPropagation();

            }
        );


        searchButton.addEventListener(
            'click',
            event => {

                event.preventDefault();

                event.stopPropagation();


                clearSearchTimer();


                performLocationSearch(
                    input.value,
                    results
                );

            }
        );


        row.append(
            input,
            searchButton
        );


        wrapper.append(
            row,
            results
        );


        return wrapper;

    }


    /* ==========================================================
       LOCATION
       ========================================================== */

    function buildLocationLabel() {

        const location =
            document.createElement(
                'div'
            );


        location.className =
            'wind-crotone-location';


        const pin =
            document.createElement(
                'span'
            );


        pin.textContent =
            '⌖';


        const text =
            document.createElement(
                'strong'
            );


        text.textContent =
            currentLocation.label;


        location.append(
            pin,
            text
        );


        return location;

    }


    /* ==========================================================
       PANEL
       ========================================================== */

    function createPanel() {

        if (panel) {

            return;

        }


        panel =
            document.createElement(
                'div'
            );


        panel.className =
            'wind-crotone-panel';


        panel.setAttribute(
            'role',
            'region'
        );


        panel.setAttribute(
            'aria-label',
            'Meteo, mare e previsioni del vento'
        );


        map
            .getContainer()
            .appendChild(
                panel
            );


        updatePanelLoading();

    }


    /* ==========================================================
       REOPEN
       ========================================================== */

    function createPanelToggleButton() {

        if (
            panelToggleButton
        ) {

            return;

        }


        panelToggleButton =
            document.createElement(
                'button'
            );


        panelToggleButton.type =
            'button';


        panelToggleButton.className =
            'wind-crotone-reopen';


        panelToggleButton.textContent =
            '🌬';


        panelToggleButton.setAttribute(
            'aria-label',
            'Apri meteo, mare e previsioni vento'
        );


        panelToggleButton.title =
            'Meteo, mare e vento';


        panelToggleButton.addEventListener(
            'pointerdown',
            event => {

                event.preventDefault();

                event.stopPropagation();

            }
        );


        panelToggleButton.addEventListener(
            'click',
            event => {

                event.preventDefault();

                event.stopPropagation();


                showPanel();

                updatePanel();

            }
        );


        map
            .getContainer()
            .appendChild(
                panelToggleButton
            );

    }


    function showPanel() {

        if (!panel) {

            return;

        }


        panel
            .classList
            .remove(
                'is-hidden'
            );


        panel.setAttribute(
            'aria-hidden',
            'false'
        );


        panelToggleButton
            ?.classList
            .remove(
                'is-visible'
            );

    }


    function hidePanel() {

        if (!panel) {

            return;

        }


        panel
            .classList
            .add(
                'is-hidden'
            );


        panel.setAttribute(
            'aria-hidden',
            'true'
        );


        panelToggleButton
            ?.classList
            .add(
                'is-visible'
            );

    }


    function handleOutsidePanelPointerDown(
        event
    ) {

        if (

            !active

            ||

            !panel

            ||

            panel
                .classList
                .contains(
                    'is-hidden'
                )

        ) {

            return;

        }


        if (

            event.target
            instanceof Node

            &&

            panel.contains(
                event.target
            )

        ) {

            return;

        }


        if (

            panelToggleButton

            &&

            event.target
            instanceof Node

            &&

            panelToggleButton.contains(
                event.target
            )

        ) {

            return;

        }


        hidePanel();

    }


    /* ==========================================================
       LOADING
       ========================================================== */

    function updatePanelLoading() {

        if (!panel) {

            return;

        }


        panel
            .replaceChildren();


        panel.append(
            buildSearchBox(),
            buildLocationLabel()
        );


        const loadingNode =
            document.createElement(
                'div'
            );


        loadingNode.className =
            'wind-crotone-loading';


        loadingNode.textContent =
            'Caricamento previsioni…';


        panel.appendChild(
            loadingNode
        );

    }


    function updatePanelError(
        text =
            'Dati meteo non disponibili'
    ) {

        if (!panel) {

            return;

        }


        panel
            .replaceChildren();


        panel.append(
            buildSearchBox(),
            buildLocationLabel()
        );


        const error =
            document.createElement(
                'div'
            );


        error.className =
            'wind-crotone-loading';


        error.textContent =
            text;


        panel.appendChild(
            error
        );

    }


    /* ==========================================================
       FORMAT
       ========================================================== */

    function formatTemperature(
        value
    ) {

        return Number.isFinite(
            value
        )

            ?

            `${Math.round(
                value
            )}°`

            :

            '—';

    }


    function formatPercent(
        value
    ) {

        return Number.isFinite(
            value
        )

            ?

            `${Math.round(
                clamp(
                    value,
                    0,
                    100
                )
            )}%`

            :

            '—';

    }


    function formatMillimeters(
        value
    ) {

        if (
            !Number.isFinite(
                value
            )
        ) {

            return '—';

        }


        return `${
            value < 10
                ?
                value.toFixed(1)
                :
                Math.round(value)
        } mm`;

    }


    function formatMeters(
        value,
        decimals = 1
    ) {

        if (
            !Number.isFinite(
                value
            )
        ) {

            return '—';

        }


        return `${
            value.toFixed(
                decimals
            )
        } m`;

    }


    function formatSeconds(
        value
    ) {

        if (
            !Number.isFinite(
                value
            )
        ) {

            return '—';

        }


        return `${
            value.toFixed(1)
        } s`;

    }


    function formatKmh(
        value
    ) {

        if (
            !Number.isFinite(
                value
            )
        ) {

            return '—';

        }


        return `${
            value.toFixed(
                value < 10
                    ?
                    1
                    :
                    0
            )
        } km/h`;

    }


    /* ==========================================================
       WEATHER METRIC
       ========================================================== */

    function createWeatherMetric(
        label,
        value,
        detail = ''
    ) {

        const metric =
            document.createElement(
                'div'
            );


        metric.className =
            'wind-crotone-weather-metric';


        const labelNode =
            document.createElement(
                'span'
            );


        labelNode.className =
            'wind-crotone-weather-metric-label';


        labelNode.textContent =
            label;


        const valueNode =
            document.createElement(
                'strong'
            );


        valueNode.className =
            'wind-crotone-weather-metric-value';


        valueNode.textContent =
            value;


        metric.append(
            labelNode,
            valueNode
        );


        if (detail) {

            const detailNode =
                document.createElement(
                    'small'
                );


            detailNode.className =
                'wind-crotone-weather-metric-detail';


            detailNode.textContent =
                detail;


            metric.appendChild(
                detailNode
            );

        }


        return metric;

    }


    /* ==========================================================
       WEATHER VIEW
       ========================================================== */

    function buildWeatherBlock(
        atmosphere,
        wind
    ) {

        const wrapper =
            document.createElement(
                'div'
            );


        wrapper.className =
            'wind-crotone-weather';


        const descriptor =

            weatherDescriptor(
                atmosphere.weatherCode,
                atmosphere.isDay
            );


        const summary =
            document.createElement(
                'div'
            );


        summary.className =
            'wind-crotone-weather-summary';


        const icon =
            document.createElement(
                'div'
            );


        icon.className =
            'wind-crotone-weather-icon';


        icon.textContent =
            descriptor.icon;


        const temperature =
            document.createElement(
                'div'
            );


        temperature.className =
            'wind-crotone-weather-temperature';


        temperature.textContent =

            formatTemperature(
                atmosphere.temperatureC
            );


        const copy =
            document.createElement(
                'div'
            );


        copy.className =
            'wind-crotone-weather-copy';


        const condition =
            document.createElement(
                'strong'
            );


        condition.textContent =
            descriptor.label;


        const apparent =
            document.createElement(
                'small'
            );


        apparent.textContent =

            `Percepita ${
                formatTemperature(
                    atmosphere.apparentTemperatureC
                )
            }`;


        copy.append(
            condition,
            apparent
        );


        summary.append(
            icon,
            temperature,
            copy
        );


        const grid =
            document.createElement(
                'div'
            );


        grid.className =
            'wind-crotone-weather-grid';


        grid.append(

            createWeatherMetric(

                'Precipit.',

                formatPercent(
                    atmosphere.precipitationProbabilityPct
                ),

                formatMillimeters(
                    atmosphere.precipitationMm
                )

            ),


            createWeatherMetric(

                'Nuvole',

                formatPercent(
                    atmosphere.cloudCoverPct
                )

            ),


            createWeatherMetric(

                'Umidità',

                formatPercent(
                    atmosphere.humidityPct
                )

            ),


            createWeatherMetric(

                'Pressione',

                Number.isFinite(
                    atmosphere.pressureMslHpa
                )

                    ?

                    `${
                        Math.round(
                            atmosphere.pressureMslHpa
                        )
                    } hPa`

                    :

                    '—'

            )

        );


        /* VENTO */

        const windBlock =
            document.createElement(
                'div'
            );


        windBlock.className =
            'wind-crotone-weather-wind';


        const heading =
            document.createElement(
                'div'
            );


        heading.className =
            'wind-crotone-panel-head wind-crotone-wind-head';


        const windIcon =
            document.createElement(
                'span'
            );


        windIcon.className =
            'wind-crotone-panel-icon';


        windIcon.textContent =
            '↑';


        windIcon.style.transform =

            `rotate(${
                wind.directionFrom
                +
                180
            }deg)`;


        const title =
            document.createElement(
                'strong'
            );


        title.textContent =

            selectedFrameId ===
                'current'

                ?

                'Vento adesso'

                :

                `Vento · ${weather.hour}`;


        heading.append(
            windIcon,
            title
        );


        const main =
            document.createElement(
                'div'
            );


        main.className =
            'wind-crotone-panel-main';


        main.textContent =

            `${Math.round(
                wind.speedKmh
            )} km/h · ${
                directionLabel(
                    wind.directionFrom
                )
            }`;


        const gust =
            document.createElement(
                'small'
            );


        gust.textContent =

            `Raffiche ${
                Math.round(
                    wind.gustKmh
                )
            } km/h`;


        windBlock.append(
            heading,
            main,
            gust
        );


        wrapper.append(
            summary,
            grid,
            windBlock
        );


        return wrapper;

    }


    /* ==========================================================
       MARINE METRIC
       ========================================================== */

    function createMarineMetric(
        label,
        value,
        detail = ''
    ) {

        const metric =
            document.createElement(
                'div'
            );


        metric.className =
            'wind-crotone-marine-metric';


        const labelNode =
            document.createElement(
                'span'
            );


        labelNode.className =
            'wind-crotone-marine-label';


        labelNode.textContent =
            label;


        const valueNode =
            document.createElement(
                'strong'
            );


        valueNode.className =
            'wind-crotone-marine-value';


        valueNode.textContent =
            value;


        metric.append(
            labelNode,
            valueNode
        );


        if (detail) {

            const detailNode =
                document.createElement(
                    'small'
                );


            detailNode.className =
                'wind-crotone-marine-detail';


            detailNode.textContent =
                detail;


            metric.appendChild(
                detailNode
            );

        }


        return metric;

    }


    /* ==========================================================
       MARINE UNAVAILABLE
       ========================================================== */

    function buildMarineUnavailable(
        message
    ) {

        const wrapper =
            document.createElement(
                'div'
            );


        wrapper.className =
            'wind-crotone-marine-empty';


        const icon =
            document.createElement(
                'span'
            );


        icon.textContent =
            '🌊';


        const text =
            document.createElement(
                'div'
            );


        const title =
            document.createElement(
                'strong'
            );


        title.textContent =
            'Dati marini non disponibili';


        const detail =
            document.createElement(
                'small'
            );


        detail.textContent =
            message;


        text.append(
            title,
            detail
        );


        wrapper.append(
            icon,
            text
        );


        return wrapper;

    }


    /* ==========================================================
       MARE VIEW
       ========================================================== */

    function buildMarineBlock() {

        if (

            marineLoading

            &&

            !marineDataset

        ) {

            const loadingNode =
                document.createElement(
                    'div'
                );


            loadingNode.className =
                'wind-crotone-loading';


            loadingNode.textContent =
                'Caricamento dati marini…';


            return loadingNode;

        }


        if (
            !marineDataset
        ) {

            return buildMarineUnavailable(
                'Servizio marino momentaneamente non disponibile.'
            );

        }


        if (
            !marineDataset.available
        ) {

            const distance =

                Number(
                    marineDataset
                        .marinePoint
                        ?.distanceKm
                );


            const detail =

                Number.isFinite(
                    distance
                )

                    ?

                    `La cella marina più vicina è a circa ${
                        distance.toFixed(1)
                    } km: la località è considerata troppo interna.`

                    :

                    'La località è considerata troppo interna rispetto alla costa.';


            return buildMarineUnavailable(
                detail
            );

        }


        const marine =
            getSelectedMarineFrame();


        if (!marine) {

            return buildMarineUnavailable(
                'Nessun frame marino disponibile per questo giorno e questa ora.'
            );

        }


        const wrapper =
            document.createElement(
                'div'
            );


        wrapper.className =
            'wind-crotone-marine';


        const hero =
            document.createElement(
                'div'
            );


        hero.className =
            'wind-crotone-marine-hero';


        const icon =
            document.createElement(
                'span'
            );


        icon.className =
            'wind-crotone-marine-icon';


        icon.textContent =
            '🌊';


        const heroCopy =
            document.createElement(
                'div'
            );


        const heroTitle =
            document.createElement(
                'strong'
            );


        heroTitle.textContent =
            'Moto ondoso';


        const heroValue =
            document.createElement(
                'div'
            );


        heroValue.className =
            'wind-crotone-marine-hero-value';


        const direction =

            Number.isFinite(
                marine.waveDirectionFrom
            )

                ?

                `${
                    directionLabel(
                        marine.waveDirectionFrom
                    )
                } ${
                    Math.round(
                        marine.waveDirectionFrom
                    )
                }°`

                :

                '—';


        heroValue.textContent =

            `${
                formatMeters(
                    marine.waveHeightM
                )
            } · ${
                direction
            }`;


        heroCopy.append(
            heroTitle,
            heroValue
        );


        hero.append(
            icon,
            heroCopy
        );


        const grid =
            document.createElement(
                'div'
            );


        grid.className =
            'wind-crotone-marine-grid';


        grid.append(

            createMarineMetric(

                'Periodo onda',

                formatSeconds(
                    marine.wavePeriodS
                ),

                Number.isFinite(
                    marine.wavePeakPeriodS
                )

                    ?

                    `Picco ${
                        formatSeconds(
                            marine.wavePeakPeriodS
                        )
                    }`

                    :

                    ''

            ),


            createMarineMetric(

                'Swell',

                formatMeters(
                    marine.swellWaveHeightM
                ),

                Number.isFinite(
                    marine.swellWaveDirectionFrom
                )

                    ?

                    `${
                        directionLabel(
                            marine.swellWaveDirectionFrom
                        )
                    } · ${
                        formatSeconds(
                            marine.swellWavePeriodS
                        )
                    }`

                    :

                    formatSeconds(
                        marine.swellWavePeriodS
                    )

            ),


            createMarineMetric(

                'Temp. mare',

                Number.isFinite(
                    marine.seaSurfaceTemperatureC
                )

                    ?

                    `${
                        marine
                            .seaSurfaceTemperatureC
                            .toFixed(1)
                    } °C`

                    :

                    '—'

            ),


            createMarineMetric(

                'Corrente',

                formatKmh(
                    marine.oceanCurrentVelocityKmh
                ),

                Number.isFinite(
                    marine.oceanCurrentDirectionTo
                )

                    ?

                    `verso ${
                        directionLabel(
                            marine.oceanCurrentDirectionTo
                        )
                    } · ${
                        Math.round(
                            marine.oceanCurrentDirectionTo
                        )
                    }°`

                    :

                    ''

            ),


            createMarineMetric(

                'Onda vento',

                formatMeters(
                    marine.windWaveHeightM
                ),

                Number.isFinite(
                    marine.windWaveDirectionFrom
                )

                    ?

                    `${
                        directionLabel(
                            marine.windWaveDirectionFrom
                        )
                    } · ${
                        formatSeconds(
                            marine.windWavePeriodS
                        )
                    }`

                    :

                    formatSeconds(
                        marine.windWavePeriodS
                    )

            ),


            createMarineMetric(

                'Livello mare*',

                formatMeters(
                    marine.seaLevelHeightMslM,
                    2
                ),

                'riferito al livello medio globale'

            )

        );


        const note =
            document.createElement(
                'small'
            );


        note.className =
            'wind-crotone-marine-note';


        note.textContent =
            'Dati modellistici: correnti e livello mare vicino costa sono indicativi e non adatti alla navigazione.';


        wrapper.append(
            hero,
            grid,
            note
        );


        return wrapper;

    }


    /* ==========================================================
       FASE LUNARE LOCALE
       ========================================================== */

    function moonPhaseFraction(
        date
    ) {

        if (

            !(date instanceof Date)

            ||

            Number.isNaN(
                date.getTime()
            )

        ) {

            return null;

        }


        const synodicMonthDays =
            29.530588853;


        const referenceNewMoonUtc =

            Date.UTC(
                2000,
                0,
                6,
                18,
                14,
                0
            );


        const days =

            (
                date.getTime()
                -
                referenceNewMoonUtc
            )

            /

            86400000;


        return (

            (
                days
                /
                synodicMonthDays
            )

            %

            1

            +

            1

        ) % 1;

    }


    function moonPhaseLabel(
        phase
    ) {

        if (
            !Number.isFinite(
                phase
            )
        ) {

            return '—';

        }


        if (
            phase < 0.03
            ||
            phase >= 0.97
        ) {

            return 'Luna nuova';

        }


        if (
            phase < 0.22
        ) {

            return 'Crescente';

        }


        if (
            phase < 0.28
        ) {

            return 'Primo quarto';

        }


        if (
            phase < 0.47
        ) {

            return 'Gibbosa crescente';

        }


        if (
            phase < 0.53
        ) {

            return 'Luna piena';

        }


        if (
            phase < 0.72
        ) {

            return 'Gibbosa calante';

        }


        if (
            phase < 0.78
        ) {

            return 'Ultimo quarto';

        }


        return 'Calante';

    }


    function selectedFrameDate() {

        const value =
            weather?.time
            ||
            null;


        if (!value) {

            return new Date();

        }


        const parsed =
            new Date(
                value
            );


        return Number.isNaN(
            parsed.getTime()
        )

            ?

            new Date()

            :

            parsed;

    }


    /* ==========================================================
       INDICE PESCA

       È deliberatamente definito come INDICE EURISTICO,
       non come misura biologica.
       ========================================================== */

    function calculateFishingIndex(
        atmosphere,
        wind,
        marine
    ) {

        let score =
            50;


        const factors =
            [];


        /* ONDE */

        if (

            marine

            &&

            Number.isFinite(
                marine.waveHeightM
            )

        ) {

            if (

                marine.waveHeightM >= 0.15

                &&

                marine.waveHeightM <= 1.2

            ) {

                score +=
                    10;


                factors.push(
                    'Mare gestibile'
                );

            } else if (
                marine.waveHeightM > 2.5
            ) {

                score -=
                    14;


                factors.push(
                    'Onde alte'
                );

            } else if (

                marine.waveHeightM > 1.2

                &&

                marine.waveHeightM <= 2.0

            ) {

                score +=
                    2;


                factors.push(
                    'Mare mosso'
                );

            }

        }


        /* CORRENTE */

        if (

            marine

            &&

            Number.isFinite(
                marine.oceanCurrentVelocityKmh
            )

        ) {

            if (

                marine.oceanCurrentVelocityKmh >= 0.1

                &&

                marine.oceanCurrentVelocityKmh <= 1.5

            ) {

                score +=
                    9;


                factors.push(
                    'Corrente moderata'
                );

            } else if (
                marine.oceanCurrentVelocityKmh > 3.0
            ) {

                score -=
                    8;


                factors.push(
                    'Corrente forte'
                );

            } else if (
                marine.oceanCurrentVelocityKmh < 0.1
            ) {

                score -=
                    3;


                factors.push(
                    'Corrente debole'
                );

            }

        }


        /* VENTO */

        if (

            wind

            &&

            Number.isFinite(
                wind.speedKmh
            )

        ) {

            if (

                wind.speedKmh >= 4

                &&

                wind.speedKmh <= 22

            ) {

                score +=
                    5;


                factors.push(
                    'Vento moderato'
                );

            } else if (
                wind.speedKmh > 35
            ) {

                score -=
                    12;


                factors.push(
                    'Vento forte'
                );

            }

        }


        /* METEO */

        if (
            atmosphere
        ) {

            const code =
                Number(
                    atmosphere.weatherCode
                );


            if (
                [95, 96, 99]
                    .includes(
                        code
                    )
            ) {

                score -=
                    25;


                factors.push(
                    'Temporali'
                );

            } else if (

                Number.isFinite(
                    atmosphere.precipitationProbabilityPct
                )

                &&

                atmosphere.precipitationProbabilityPct >
                    75

            ) {

                score -=
                    6;


                factors.push(
                    'Pioggia probabile'
                );

            }

        }


        /* LUNA */

        const phase =

            moonPhaseFraction(
                selectedFrameDate()
            );


        if (
            Number.isFinite(
                phase
            )
        ) {

            const distanceFromNew =

                Math.min(
                    phase,
                    1 - phase
                );


            const distanceFromFull =

                Math.abs(
                    phase - 0.5
                );


            const syzygyDistance =

                Math.min(
                    distanceFromNew,
                    distanceFromFull
                );


            if (
                syzygyDistance < 0.08
            ) {

                score +=
                    7;


                factors.push(
                    'Fase lunare marcata'
                );

            } else if (
                syzygyDistance < 0.15
            ) {

                score +=
                    3;

            }

        }


        score =

            Math.round(

                clamp(
                    score,
                    0,
                    100
                )

            );


        let label =
            'Bassa';


        if (
            score >= 75
        ) {

            label =
                'Alta';

        } else if (
            score >= 55
        ) {

            label =
                'Buona';

        } else if (
            score >= 35
        ) {

            label =
                'Moderata';

        }


        return {

            score,

            label,

            factors:

                factors.slice(
                    0,
                    4
                ),

            moonPhase:
                phase,

            moonLabel:

                moonPhaseLabel(
                    phase
                )

        };

    }


    /* ==========================================================
       PESCA VIEW
       ========================================================== */

    function buildFishingBlock(
        atmosphere,
        wind
    ) {

        if (

            marineLoading

            &&

            !marineDataset

        ) {

            const loadingNode =
                document.createElement(
                    'div'
                );


            loadingNode.className =
                'wind-crotone-loading';


            loadingNode.textContent =
                'Calcolo condizioni pesca…';


            return loadingNode;

        }


        if (

            !marineDataset

            ||

            !marineDataset.available

        ) {

            return buildMarineUnavailable(
                'L’indice pesca richiede dati marini affidabilmente associabili alla costa della località selezionata.'
            );

        }


        const marine =
            getSelectedMarineFrame();


        if (!marine) {

            return buildMarineUnavailable(
                'Nessun frame marino disponibile per calcolare l’indice in questo orario.'
            );

        }


        const result =

            calculateFishingIndex(
                atmosphere,
                wind,
                marine
            );


        const wrapper =
            document.createElement(
                'div'
            );


        wrapper.className =
            'wind-crotone-fishing';


        const header =
            document.createElement(
                'div'
            );


        header.className =
            'wind-crotone-fishing-header';


        const icon =
            document.createElement(
                'span'
            );


        icon.className =
            'wind-crotone-fishing-icon';


        icon.textContent =
            '🐟';


        const copy =
            document.createElement(
                'div'
            );


        const title =
            document.createElement(
                'strong'
            );


        title.textContent =
            'Attività ittica stimata';


        const subtitle =
            document.createElement(
                'small'
            );


        subtitle.textContent =
            'Indice indicativo attività dei pesci';


        copy.append(
            title,
            subtitle
        );


        const badge =
            document.createElement(
                'div'
            );


        badge.className =
            'wind-crotone-fishing-badge';


        badge.textContent =
            result.label;


        header.append(
            icon,
            copy,
            badge
        );


        const meter =
            document.createElement(
                'div'
            );


        meter.className =
            'wind-crotone-fishing-meter';


        const meterBar =
            document.createElement(
                'div'
            );


        meterBar.className =
            'wind-crotone-fishing-meter-bar';


        meterBar.style.width =
            `${result.score}%`;


        meter.appendChild(
            meterBar
        );


        const scoreLine =
            document.createElement(
                'div'
            );


        scoreLine.className =
            'wind-crotone-fishing-score';


        scoreLine.textContent =
            `${result.score}/100`;


        const grid =
            document.createElement(
                'div'
            );


        grid.className =
            'wind-crotone-fishing-grid';


        grid.append(

            createMarineMetric(

                'Moto ondoso',

                formatMeters(
                    marine.waveHeightM
                ),

                Number.isFinite(
                    marine.wavePeriodS
                )

                    ?

                    `periodo ${
                        formatSeconds(
                            marine.wavePeriodS
                        )
                    }`

                    :

                    ''

            ),


            createMarineMetric(

                'Corrente',

                formatKmh(
                    marine.oceanCurrentVelocityKmh
                ),

                Number.isFinite(
                    marine.oceanCurrentDirectionTo
                )

                    ?

                    `verso ${
                        directionLabel(
                            marine.oceanCurrentDirectionTo
                        )
                    }`

                    :

                    ''

            ),


            createMarineMetric(

                'Temp. mare',

                Number.isFinite(
                    marine.seaSurfaceTemperatureC
                )

                    ?

                    `${
                        marine
                            .seaSurfaceTemperatureC
                            .toFixed(1)
                    } °C`

                    :

                    '—'

            ),


            createMarineMetric(

                'Luna',

                result.moonLabel

            )

        );


        const factorWrap =
            document.createElement(
                'div'
            );


        factorWrap.className =
            'wind-crotone-fishing-factors';


        for (
            const factor
            of result.factors
        ) {

            const chip =
                document.createElement(
                    'span'
                );


            chip.textContent =
                factor;


            factorWrap.appendChild(
                chip
            );

        }


        const note =
            document.createElement(
                'small'
            );


        note.className =
            'wind-crotone-fishing-note';


        note.textContent =
            'Stima indicativa basata su mare, corrente, vento, meteo e fase lunare. Non rappresenta un rilevamento diretto dei pesci e può variare in base a specie, habitat e tecnica di pesca.';


        wrapper.append(
            header,
            meter,
            scoreLine,
            grid,
            factorWrap,
            note
        );


        return wrapper;

    }


    /* ==========================================================
       TABS
       ========================================================== */

    function buildViewTabs() {

        const tabs =
            document.createElement(
                'div'
            );


        tabs.className =
            'wind-crotone-tabs';


        tabs.setAttribute(
            'role',
            'tablist'
        );


        const entries = [

            [
                'weather',
                'Meteo'
            ],

            [
                'marine',
                'Mare'
            ],

            [
                'fishing',
                'Pesca'
            ]

        ];


        for (
            const [
                id,
                label
            ]
            of entries
        ) {

            const button =
                document.createElement(
                    'button'
                );


            button.type =
                'button';


            button.className =
                'wind-crotone-tab-btn';


            button.textContent =
                label;


            button.setAttribute(
                'role',
                'tab'
            );


            button.setAttribute(
                'aria-selected',
                activeView === id
                    ?
                    'true'
                    :
                    'false'
            );


            if (
                activeView === id
            ) {

                button
                    .classList
                    .add(
                        'is-active'
                    );

            }


            button.addEventListener(
                'click',
                event => {

                    event.preventDefault();

                    event.stopPropagation();


                    activeView =
                        id;


                    updatePanel();

                }
            );


            tabs.appendChild(
                button
            );

        }


        return tabs;

    }


    /* ==========================================================
       DAYS
       ========================================================== */

        function buildDaySelector() {

        const container =
            document.createElement(
                'div'
            );


        container.className =
            'wind-crotone-days';


        for (
            const day
            of getVisibleDays()
        ) {

            const button =
                document.createElement(
                    'button'
                );


            button.type =
                'button';


            button.className =
                'wind-crotone-day-btn';


            button.textContent =
                formatDayLabel(
                    day
                );


            const activeDate =

                timeMode ===
                    'night'

                    ?

                    selectedDayAnchorDate

                    :

                    selectedDayDate;


            if (
                day.date ===
                activeDate
            ) {

                button
                    .classList
                    .add(
                        'is-active'
                    );

            }


            button.addEventListener(
                'click',
                event => {

                    event.preventDefault();

                    event.stopPropagation();


                    selectDay(
                        day.date
                    );

                }
            );


            container.appendChild(
                button
            );

        }


        return container;

    }


    /* ==========================================================
       HOURS
       ========================================================== */

        function buildHourSelector() {

        const container =
            document.createElement(
                'div'
            );


        container.className =
            'wind-crotone-hours';


        container
            .classList
            .toggle(
                'is-night',
                timeMode ===
                    'night'
            );


        if (
            timeMode ===
                'night'
        ) {

            const entries =
                getNightEntries();


            for (
                const entry
                of entries
            ) {

                const button =
                    document.createElement(
                        'button'
                    );


                button.type =
                    'button';


                button.className =
                    'wind-crotone-hour-btn';


                button.textContent =
                    entry.label;


                if (
                    !entry.slot
                ) {

                    button.disabled =
                        true;


                    button
                        .classList
                        .add(
                            'is-unavailable'
                        );


                    button.setAttribute(
                        'aria-label',
                        `${entry.label}: previsione notturna non disponibile`
                    );


                    container.appendChild(
                        button
                    );


                    continue;

                }


                if (
                    selectedFrameId ===
                        entry.slot.id
                ) {

                    button
                        .classList
                        .add(
                            'is-active'
                        );

                }


                const dayLabel =

                    entry.sourceDay

                        ?

                        formatDayLabel(
                            entry.sourceDay
                        )

                        :

                        '';


                button.title =

                    entry.nextDay

                        ?

                        `${dayLabel} · ore ${entry.label}`

                        :

                        `Ore ${entry.label}`;


                button.setAttribute(
                    'aria-label',

                    entry.nextDay

                        ?

                        `${dayLabel}, ore ${entry.label}`

                        :

                        `Ore ${entry.label}`
                );


                button.addEventListener(
                    'click',
                    event => {

                        event.preventDefault();

                        event.stopPropagation();


                        selectFrame(
                            entry.slot.id,
                            {
                                preserveAnchor:
                                    true
                            }
                        );

                    }
                );


                container.appendChild(
                    button
                );

            }


            return container;

        }


        const day =
            getDay(
                selectedDayDate
            );


        if (!day) {

            return container;

        }


        if (
            day.dayOffset ===
                0
        ) {

            const now =
                document.createElement(
                    'button'
                );


            now.type =
                'button';


            now.className =
                'wind-crotone-hour-btn';


            now.textContent =
                'Adesso';


            if (
                selectedFrameId ===
                    'current'
            ) {

                now
                    .classList
                    .add(
                        'is-active'
                    );

            }


            now.addEventListener(
                'click',
                event => {

                    event.preventDefault();

                    event.stopPropagation();


                    selectedDayAnchorDate =
                        day.date;


                    selectFrame(
                        'current',
                        {
                            preserveAnchor:
                                true
                        }
                    );

                }
            );


            container.appendChild(
                now
            );

        }


        for (
            const slot
            of getStandardSlots(
                day
            )
        ) {

            const button =
                document.createElement(
                    'button'
                );


            button.type =
                'button';


            button.className =
                'wind-crotone-hour-btn';


            button.textContent =
                slot.hour;


            if (
                selectedFrameId ===
                    slot.id
            ) {

                button
                    .classList
                    .add(
                        'is-active'
                    );

            }


            button.addEventListener(
                'click',
                event => {

                    event.preventDefault();

                    event.stopPropagation();


                    selectedDayAnchorDate =
                        day.date;


                    selectFrame(
                        slot.id,
                        {
                            preserveAnchor:
                                true
                        }
                    );

                }
            );


            container.appendChild(
                button
            );

        }


        return container;

    }


    /* ==========================================================
       TIME LABEL
       ========================================================== */

        function buildTimeLabel() {

        const frameTime =
            document.createElement(
                'div'
            );


        frameTime.className =
            'wind-crotone-panel-time';


        const text =
            document.createElement(
                'span'
            );


        text.className =
            'wind-crotone-panel-time-text';


        if (
            selectedFrameId ===
                'current'
        ) {

            text.textContent =
                'Condizioni attuali';

        } else {

            const day =
                getDay(
                    selectedDayDate
                );


            text.textContent =

                `${
                    day
                        ?
                        formatDayLabel(
                            day
                        )
                        :
                        ''
                } · ore ${
                    weather.hour
                }`;

        }


        if (

            dataset?.stale

            ||

            marineDataset?.stale

        ) {

            text.textContent +=
                ' · dati recenti';

        }


        const toggle =
            document.createElement(
                'button'
            );


        toggle.type =
            'button';


        toggle.className =
            'wind-crotone-night-toggle';


        toggle
            .classList
            .toggle(
                'is-active',
                timeMode ===
                    'night'
            );


        toggle.textContent =

            timeMode ===
                'night'

                ?

                '☀'

                :

                '☾';


        toggle.title =

            timeMode ===
                'night'

                ?

                'Mostra orari standard'

                :

                'Mostra orari notturni';


        toggle.setAttribute(
            'aria-label',

            timeMode ===
                'night'

                ?

                'Mostra orari standard'

                :

                'Mostra orari notturni'
        );


        toggle.setAttribute(
            'aria-pressed',

            timeMode ===
                'night'

                ?

                'true'

                :

                'false'
        );


        toggle.addEventListener(
            'click',
            event => {

                event.preventDefault();

                event.stopPropagation();


                setTimeMode(

                    timeMode ===
                        'night'

                        ?

                        'standard'

                        :

                        'night'

                );

            }
        );


        frameTime.append(
            text,
            toggle
        );


        return frameTime;

    }
    
    
    
    
        /* ==========================================================
       OFFICIAL ALERTS UI
       ========================================================== */

    function isCrotoneAlertTarget() {

        return (
            String(
                currentLocation?.name
                ??
                ''
            )
            .trim()
            .toLocaleLowerCase(
                'it-IT'
            )
            ===
            'crotone'
        );

    }


    function getRomeDateKey() {

        try {

            const parts =
                new Intl.DateTimeFormat(
                    'en-GB',
                    {
                        timeZone:
                            'Europe/Rome',

                        year:
                            'numeric',

                        month:
                            '2-digit',

                        day:
                            '2-digit'
                    }
                )
                .formatToParts(
                    new Date()
                );


            const year =
                parts.find(
                    part =>
                        part.type ===
                        'year'
                )?.value;


            const month =
                parts.find(
                    part =>
                        part.type ===
                        'month'
                )?.value;


            const day =
                parts.find(
                    part =>
                        part.type ===
                        'day'
                )?.value;


            if (
                !year
                ||
                !month
                ||
                !day
            ) {

                return null;

            }


            return `${year}-${month}-${day}`;


        } catch {

            return null;

        }

    }


    function getCurrentOfficialAlert() {

        if (
            !isCrotoneAlertTarget()
            ||
            !alertDataset
            ||
            !Array.isArray(
                alertDataset.days
            )
        ) {

            return null;

        }


        const today =
            getRomeDateKey();


        if (!today) {

            return null;

        }


        return (

            alertDataset.days.find(
                day =>
                    day.date ===
                    today
            )

            ??

            null

        );

    }


    function alertLevelLabel(
        level
    ) {

        const labels = {

            none:
                'NESSUNA ALLERTA',

            yellow:
                'ALLERTA GIALLA',

            orange:
                'ALLERTA ARANCIONE',

            red:
                'ALLERTA ROSSA',

            unavailable:
                'NON DISPONIBILE'

        };


        return (
            labels[level]
            ??
            'NON DISPONIBILE'
        );

    }


    function buildOfficialAlertBar(
        day
    ) {

        if (
            !day
            ||
            ![
                'yellow',
                'orange',
                'red'
            ].includes(
                day.maxLevel
            )
        ) {

            return null;

        }


        const button =
            document.createElement(
                'button'
            );


        button.type =
            'button';


        button.className =
            `wind-crotone-alert-bar is-${day.maxLevel}`;


        button.setAttribute(
            'aria-label',
            `${alertLevelLabel(day.maxLevel)}. Apri dettagli Protezione Civile`
        );


        const icon =
            document.createElement(
                'span'
            );


        icon.className =
            'wind-crotone-alert-icon';


        icon.textContent =
            '⚠';


        const text =
            document.createElement(
                'span'
            );


        text.className =
            'wind-crotone-alert-text';


        const level =
            document.createElement(
                'strong'
            );


        level.textContent =
            alertLevelLabel(
                day.maxLevel
            );


        const separator =
            document.createElement(
                'span'
            );


        separator.className =
            'wind-crotone-alert-separator';


        separator.textContent =
            '·';


        const summary =
            document.createElement(
                'span'
            );


        summary.className =
            'wind-crotone-alert-summary';


        summary.textContent =

            alertDataset?.stale === true

                ?

                'DPC · dati non aggiornati'

                :

                'Protezione Civile · Cala-6';


        const arrow =
            document.createElement(
                'span'
            );


        arrow.className =
            'wind-crotone-alert-arrow';


        arrow.textContent =
            '›';


        text.append(
            level,
            separator,
            summary
        );


        button.append(
            icon,
            text,
            arrow
        );


        button.addEventListener(
            'click',
            event => {

                event.preventDefault();

                event.stopPropagation();


                alertDetailsOpen =
                    true;


                updatePanel();

            }
        );


        return button;

    }


    function buildAlertUnavailableNotice() {

        if (
            !isCrotoneAlertTarget()
            ||
            alertLoading
        ) {

            return null;

        }


        const day =
            getCurrentOfficialAlert();


        /*
         * Nessun avviso se il DPC dice
         * esplicitamente "none".
         */
        if (
            day
            &&
            day.maxLevel ===
                'none'
        ) {

            return null;

        }


        /*
         * Se esiste un livello valido,
         * sarà mostrata la barra colorata.
         */
        if (
            day
            &&
            [
                'yellow',
                'orange',
                'red'
            ].includes(
                day.maxLevel
            )
        ) {

            return null;

        }


        /*
         * Evita un flash prima del primo fetch.
         */
        if (
            !alertUnavailable
            &&
            alertDataset === null
        ) {

            return null;

        }


        const notice =
            document.createElement(
                'div'
            );


        notice.className =
            'wind-crotone-alert-unavailable';


        notice.setAttribute(
            'role',
            'status'
        );


        notice.textContent =
            '⚠ Dati allerta ufficiale temporaneamente non disponibili';


        return notice;

    }


    function formatAlertIssuedAt(
        value
    ) {

        if (
            typeof value !==
                'string'
        ) {

            return '—';

        }


        const date =
            new Date(
                value
            );


        if (
            Number.isNaN(
                date.getTime()
            )
        ) {

            return '—';

        }


        try {

            return (
                new Intl.DateTimeFormat(
                    'it-IT',
                    {
                        timeZone:
                            'Europe/Rome',

                        day:
                            '2-digit',

                        month:
                            '2-digit',

                        year:
                            'numeric',

                        hour:
                            '2-digit',

                        minute:
                            '2-digit'
                    }
                )
                .format(
                    date
                )
            );


        } catch {

            return '—';

        }

    }


    function buildAlertRiskRow(
        label,
        level
    ) {

        const row =
            document.createElement(
                'div'
            );


        row.className =
            `wind-crotone-alert-risk is-${level}`;


        const name =
            document.createElement(
                'strong'
            );


        name.textContent =
            label;


        const value =
            document.createElement(
                'span'
            );


        value.textContent =
            alertLevelLabel(
                level
            );


        row.append(
            name,
            value
        );


        return row;

    }


    function buildAlertDetails(
        day
    ) {

        const wrapper =
            document.createElement(
                'div'
            );


        wrapper.className =
            `wind-crotone-alert-details is-${day.maxLevel}`;


        const back =
            document.createElement(
                'button'
            );


        back.type =
            'button';


        back.className =
            'wind-crotone-alert-back';


        back.textContent =
            '← Torna a Meteo / Mare / Pesca';


        back.addEventListener(
            'click',
            event => {

                event.preventDefault();

                event.stopPropagation();


                alertDetailsOpen =
                    false;


                updatePanel();

            }
        );


        const head =
            document.createElement(
                'div'
            );


        head.className =
            'wind-crotone-alert-details-head';


        const headCopy =
            document.createElement(
                'div'
            );


        const eyebrow =
            document.createElement(
                'small'
            );


        eyebrow.textContent =
            'PROTEZIONE CIVILE';


        const title =
            document.createElement(
                'strong'
            );


        title.textContent =
            alertLevelLabel(
                day.maxLevel
            );


        headCopy.append(
            eyebrow,
            title
        );


        const badge =
            document.createElement(
                'span'
            );


        badge.className =
            'wind-crotone-alert-level';


        badge.textContent =
            day.maxLevel;


        head.append(
            headCopy,
            badge
        );


        const risks =
            document.createElement(
                'div'
            );


        risks.className =
            'wind-crotone-alert-risk-list';


        risks.append(
            buildAlertRiskRow(
                'Rischio idraulico',
                day.hydraulic
            ),

            buildAlertRiskRow(
                'Rischio temporali',
                day.thunderstorm
            ),

            buildAlertRiskRow(
                'Rischio idrogeologico',
                day.hydrogeological
            )
        );


        const meta =
            document.createElement(
                'div'
            );


        meta.className =
            'wind-crotone-alert-meta';


        const zone =
            document.createElement(
                'div'
            );


        zone.className =
            'wind-crotone-alert-meta-row';


        const zoneLabel =
            document.createElement(
                'span'
            );


        zoneLabel.textContent =
            'Zona';


        const zoneValue =
            document.createElement(
                'strong'
            );


        zoneValue.textContent =
            'Cala-6 · Versante Jonico Centro-settentrionale';


        zone.append(
            zoneLabel,
            zoneValue
        );


        const issued =
            document.createElement(
                'div'
            );


        issued.className =
            'wind-crotone-alert-meta-row';


        const issuedLabel =
            document.createElement(
                'span'
            );


        issuedLabel.textContent =
            'Bollettino';


        const issuedValue =
            document.createElement(
                'strong'
            );


        issuedValue.textContent =
            formatAlertIssuedAt(
                alertDataset
                    ?.bulletin
                    ?.issuedAt
            );


        issued.append(
            issuedLabel,
            issuedValue
        );


        meta.append(
            zone,
            issued
        );


        wrapper.append(
            back,
            head,
            risks,
            meta
        );


        if (
            day.complete !==
                true
        ) {

            const partial =
                document.createElement(
                    'small'
                );


            partial.className =
                'wind-crotone-alert-note';


            partial.textContent =
                'Valutazione parziale: uno o più rischi non risultano disponibili.';


            wrapper.appendChild(
                partial
            );

        }


        if (
            alertDataset?.stale ===
                true
        ) {

            const stale =
                document.createElement(
                    'small'
                );


            stale.className =
                'wind-crotone-alert-note';


            stale.textContent =
                'Attenzione: i dati visualizzati provengono dall’ultima copia valida disponibile e potrebbero non includere aggiornamenti successivi.';


            wrapper.appendChild(
                stale
            );

        }


        const source =
            document.createElement(
                'a'
            );


        source.className =
            'wind-crotone-alert-source';


        source.href =
            'https://mappe.protezionecivile.gov.it/it/mappe-rischi/bollettino-di-criticita/index.html';


        source.target =
            '_blank';


        source.rel =
            'noopener noreferrer';


        source.textContent =
            'Apri il bollettino ufficiale DPC';


        wrapper.appendChild(
            source
        );


        return wrapper;

    }
    
    
    

    /* ==========================================================
       UPDATE PANEL
       ========================================================== */

       function updatePanel() {

        if (
            !panel
            ||
            !dataset
            ||
            !weather
        ) {

            return;

        }


        const wind =
            sampleWind(
                currentLocation.lat,
                currentLocation.lng
            );


        const atmosphere =
            sampleAtmosphere(
                currentLocation.lat,
                currentLocation.lng
            );


        if (
            !wind
            ||
            !atmosphere
        ) {

            updatePanelError();

            return;

        }


        panel
            .replaceChildren();


        const search =
            buildSearchBox();


        const location =
            buildLocationLabel();


        const officialAlert =
            getCurrentOfficialAlert();


        const hasOfficialAlert =
            officialAlert
            &&
            [
                'yellow',
                'orange',
                'red'
            ].includes(
                officialAlert.maxLevel
            );


        /*
         * Se durante un refresh l'allerta sparisce
         * o non è più valida, chiudiamo automaticamente
         * la vista dettaglio.
         */
        if (
            !hasOfficialAlert
        ) {

            alertDetailsOpen =
                false;

        }


        const alertBar =
            hasOfficialAlert

                ?

                buildOfficialAlertBar(
                    officialAlert
                )

                :

                null;


        const alertUnavailableNotice =
            buildAlertUnavailableNotice();


        /*
         * MODALITÀ DETTAGLIO ALLERTA
         *
         * Manteniamo ricerca e località,
         * ma sostituiamo il contenuto centrale.
         */
        if (
            alertDetailsOpen
            &&
            hasOfficialAlert
        ) {

            panel
                .classList
                .add(
                    'is-alert-details'
                );


            panel.append(
                search,
                location
            );


            if (
                alertBar
            ) {

                panel.appendChild(
                    alertBar
                );

            }


            panel.appendChild(
                buildAlertDetails(
                    officialAlert
                )
            );


            return;

        }


        panel
            .classList
            .remove(
                'is-alert-details'
            );


        const tabs =
            buildViewTabs();


        let content =
            null;


        if (
            activeView ===
                'marine'
        ) {

            content =
                buildMarineBlock();

        } else if (
            activeView ===
                'fishing'
        ) {

            content =
                buildFishingBlock(
                    atmosphere,
                    wind
                );

        } else {

            content =
                buildWeatherBlock(
                    atmosphere,
                    wind
                );

        }


        const frameTime =
            buildTimeLabel();


        const days =
            buildDaySelector();


        const hours =
            buildHourSelector();


        const source =
            document.createElement(
                'a'
            );


        source.href =

            activeView ===
                'weather'

                ?

                'https://open-meteo.com/'

                :

                'https://open-meteo.com/en/docs/marine-weather-api';


        source.target =
            '_blank';


        source.rel =
            'noopener noreferrer';


        source.textContent =

            activeView ===
                'weather'

                ?

                'Dati meteo Open-Meteo'

                :

                'Dati meteo e marini Open-Meteo';


        panel.append(
            search,
            location
        );


        if (
            alertBar
        ) {

            panel.appendChild(
                alertBar
            );

        } else if (
            alertUnavailableNotice
        ) {

            panel.appendChild(
                alertUnavailableNotice
            );

        }


        panel.append(
            tabs,
            content,
            frameTime,
            days,
            hours,
            source
        );

    }


    /* ==========================================================
       WEATHER FETCH
       ========================================================== */

        async function loadWeather(
        options = {}
    ) {

        const resetSelection =

            options.resetSelection ===
            true;


        const previousFrameId =
            selectedFrameId;


        const previousDayDate =
            selectedDayDate;


        const previousAnchorDate =
            selectedDayAnchorDate;


        const previousTimeMode =
            timeMode;


        const requestId =
            ++weatherRequestId;


        weatherAbortController
            ?.abort();


        weatherAbortController =
            new AbortController();


        loading =
            true;


        const timeout =

            setTimeout(
                () => {

                    weatherAbortController
                        ?.abort();

                },
                12000
            );


        try {

            const url =

                `${CONFIG.weatherEndpoint}`

                +

                `?lat=${
                    encodeURIComponent(
                        currentLocation.lat
                    )
                }`

                +

                `&lng=${
                    encodeURIComponent(
                        currentLocation.lng
                    )
                }`;


            const response =

                await fetch(
                    url,
                    {

                        headers: {

                            Accept:
                                'application/json'

                        },

                        cache:
                            'no-store',

                        signal:
                            weatherAbortController.signal

                    }
                );


            if (!response.ok) {

                throw new Error(
                    `HTTP ${response.status}`
                );

            }


            const data =
                await response.json();


            if (
                requestId !==
                weatherRequestId
            ) {

                return;

            }


            dataset =

                normalizeDataset(
                    data
                );


            if (

                !resetSelection

                &&

                dataset.frames.has(
                    previousFrameId
                )

            ) {

                selectedFrameId =
                    previousFrameId;


                weather =

                    dataset.frames.get(
                        previousFrameId
                    );


                timeMode =
                    previousTimeMode;


                if (

                    previousFrameId !==
                        'current'

                    &&

                    weather.date

                ) {

                    selectedDayDate =
                        weather.date;

                } else {

                    selectedDayDate =

                        getDay(
                            previousDayDate
                        )

                            ?

                            previousDayDate

                            :

                            dataset.days.find(
                                day =>
                                    day.dayOffset ===
                                    0
                            )?.date

                            ??

                            dataset.days[0]?.date

                            ??

                            null;

                }


                selectedDayAnchorDate =

                    getDay(
                        previousAnchorDate
                    )

                        ?

                        previousAnchorDate

                        :

                        selectedDayDate;


            } else {

                selectedFrameId =
                    'current';


                weather =

                    dataset.frames.get(
                        'current'
                    );


                timeMode =
                    getDefaultTimeMode();


                selectedDayDate =

                    dataset.days.find(
                        day =>
                            day.dayOffset ===
                            0
                    )?.date

                    ??

                    dataset.days[0]?.date

                    ??

                    null;


                selectedDayAnchorDate =
                    selectedDayDate;


                if (

                    timeMode ===
                        'night'

                    &&

                    !getNightEntries(
                        selectedDayAnchorDate
                    )
                    .some(
                        entry =>
                            entry.slot
                    )

                ) {

                    timeMode =
                        'standard';

                }

            }


            initParticles();

            updatePanel();


            if (active) {

                startAnimation();

            }


        } catch (
            error
        ) {

            if (
                error?.name ===
                    'AbortError'
            ) {

                return;

            }


            console.error(
                '[WindCrotone Weather]',
                error
            );


            if (
                requestId ===
                weatherRequestId
            ) {

                updatePanelError(
                    'Previsioni non disponibili per questa località'
                );

            }


        } finally {

            clearTimeout(
                timeout
            );


            if (
                requestId ===
                weatherRequestId
            ) {

                loading =
                    false;

            }

        }

    }


    /* ==========================================================
       MARINE FETCH
       ========================================================== */

    async function loadMarine() {

        const requestId =
            ++marineRequestId;


        marineAbortController
            ?.abort();


        marineAbortController =
            new AbortController();


        marineLoading =
            true;


        const timeout =

            setTimeout(
                () => {

                    marineAbortController
                        ?.abort();

                },
                12000
            );


        try {

            const url =

                `${CONFIG.marineEndpoint}`

                +

                `?lat=${
                    encodeURIComponent(
                        currentLocation.lat
                    )
                }`

                +

                `&lng=${
                    encodeURIComponent(
                        currentLocation.lng
                    )
                }`;


            const response =

                await fetch(
                    url,
                    {

                        headers: {

                            Accept:
                                'application/json'

                        },

                        cache:
                            'no-store',

                        signal:
                            marineAbortController.signal

                    }
                );


            if (!response.ok) {

                throw new Error(
                    `HTTP ${response.status}`
                );

            }


            const data =
                await response.json();


            if (
                requestId !==
                marineRequestId
            ) {

                return;

            }


            marineDataset =

                normalizeMarineDataset(
                    data
                );


            updatePanel();


        } catch (
            error
        ) {

            if (
                error?.name ===
                    'AbortError'
            ) {

                return;

            }


            console.error(
                '[WindCrotone Marine]',
                error
            );


            if (
                requestId ===
                marineRequestId
            ) {

                marineDataset =
                    null;


                updatePanel();

            }


        } finally {

            clearTimeout(
                timeout
            );


            if (
                requestId ===
                marineRequestId
            ) {

                marineLoading =
                    false;


                updatePanel();

            }

        }

    }


    /* ==========================================================
       OFFICIAL ALERTS
       ========================================================== */

    function normalizeAlertDataset(
        data
    ) {

        if (
            !data
            ||
            typeof data !==
                'object'
            ||
            data.ok !==
                true
            ||
            data.zone?.code !==
                'Cala-6'
            ||
            data.zone?.name !==
                'Versante Jonico Centro-settentrionale'
            ||
            !Array.isArray(
                data.days
            )
            ||
            data.days.length < 1
            ||
            data.days.length > 2
        ) {

            throw new Error(
                'Formato allerte non valido'
            );

        }


        const allowed =
            new Set([
                'none',
                'yellow',
                'orange',
                'red',
                'unavailable'
            ]);


        const rank = {

            none: 0,
            yellow: 1,
            orange: 2,
            red: 3

        };


        const seenDates =
            new Set();


        const days =
            data.days.map(
                day => {

                    if (
                        !day
                        ||
                        typeof day !==
                            'object'
                        ||
                        typeof day.date !==
                            'string'
                        ||
                        !/^\d{4}-\d{2}-\d{2}$/.test(
                            day.date
                        )
                        ||
                        seenDates.has(
                            day.date
                        )
                    ) {

                        throw new Error(
                            'Data allerta non valida'
                        );

                    }


                    seenDates.add(
                        day.date
                    );


                    const levels = [

                        day.hydraulic,
                        day.thunderstorm,
                        day.hydrogeological

                    ];


                    if (
                        !levels.every(
                            level =>
                                typeof level ===
                                    'string'
                                &&
                                allowed.has(
                                    level
                                )
                        )
                    ) {

                        throw new Error(
                            'Livello allerta non valido'
                        );

                    }


                    const available =
                        levels.filter(
                            level =>
                                level !==
                                    'unavailable'
                        );


                    const expectedMax =

                        available.length === 0

                            ?

                            'unavailable'

                            :

                            available.reduce(
                                (
                                    highest,
                                    level
                                ) =>

                                    rank[level]
                                    >
                                    rank[highest]

                                        ?

                                        level

                                        :

                                        highest,

                                'none'
                            );


                    const expectedComplete =
                        !levels.includes(
                            'unavailable'
                        );


                    if (
                        day.maxLevel !==
                            expectedMax
                        ||
                        typeof day.complete !==
                            'boolean'
                        ||
                        day.complete !==
                            expectedComplete
                    ) {

                        throw new Error(
                            'Coerenza allerta non valida'
                        );

                    }


                    return {

                        date:
                            day.date,

                        hydraulic:
                            day.hydraulic,

                        thunderstorm:
                            day.thunderstorm,

                        hydrogeological:
                            day.hydrogeological,

                        maxLevel:
                            day.maxLevel,

                        complete:
                            day.complete

                    };

                }
            );


        return {

            stale:
                data.stale ===
                    true,

            zone: {

                code:
                    data.zone.code,

                name:
                    data.zone.name

            },

            bulletin: {

                title:
                    typeof data.bulletin?.title ===
                        'string'

                        ?

                        data.bulletin.title

                        :

                        '',

                issuedAt:
                    typeof data.bulletin?.issuedAt ===
                        'string'

                        ?

                        data.bulletin.issuedAt

                        :

                        null

            },

            days

        };

    }


    async function loadAlerts() {

        const requestId =
            ++alertRequestId;


        alertAbortController
            ?.abort();


        alertAbortController =
            new AbortController();


        alertLoading =
            true;


        const timeout =
            setTimeout(
                () => {

                    alertAbortController
                        ?.abort();

                },
                8000
            );


        try {

            const response =

                await fetch(
                    CONFIG.alertsEndpoint,
                    {

                        headers: {

                            Accept:
                                'application/json'

                        },

                        cache:
                            'no-store',

                        signal:
                            alertAbortController.signal

                    }
                );


            if (
                !response.ok
            ) {

                throw new Error(
                    `HTTP ${response.status}`
                );

            }


            const data =
                await response.json();


            if (
                requestId !==
                    alertRequestId
            ) {

                return;

            }


            alertDataset =
                normalizeAlertDataset(
                    data
                );


            alertUnavailable =
                false;


        } catch (
            error
        ) {

            if (
                error?.name ===
                    'AbortError'
            ) {

                return;

            }


            console.error(
                '[WindCrotone Alerts]',
                error
            );


            if (
                requestId ===
                    alertRequestId
            ) {

                alertDataset =
                    null;


                alertUnavailable =
                    true;

            }


        } finally {

            clearTimeout(
                timeout
            );


                        if (
                requestId ===
                    alertRequestId
            ) {

                alertLoading =
                    false;


                if (
                    panel
                    &&
                    dataset
                    &&
                    weather
                ) {

                    updatePanel();

                }

            }

        }

    }



    /* ==========================================================
       REFRESH
       ========================================================== */

    function startRefreshTimer() {

        stopRefreshTimer();


        refreshTimer =

            setInterval(
                () => {

                    if (

                        active

                        &&

                        !loading

                    ) {

                        loadWeather();

                    }


                    if (

                        active

                        &&

                        !marineLoading

                    ) {

                        loadMarine();

                    }
                    
                    
                                        if (

                        active

                        &&

                        !alertLoading

                    ) {

                        loadAlerts();

                    }
                    

                },
                CONFIG.refreshMs
            );

    }


    function stopRefreshTimer() {

        if (
            refreshTimer !==
                null
        ) {

            clearInterval(
                refreshTimer
            );


            refreshTimer =
                null;

        }

    }


    /* ==========================================================
       MAP EVENTS
       ========================================================== */

    function onMapSettled() {

        if (!active) {

            return;

        }


        resizeCanvas();


        if (

            dataset

            &&

            weather

        ) {

            updatePanel();

            startAnimation();

        }

    }


    /* ==========================================================
       LEAFLET LAYER
       ========================================================== */

    const WindLayer =

        L.Layer.extend({

            onAdd(
                mapInstance
            ) {

                map =
                    mapInstance;


                active =
                    true;


                createCanvas();

                createPanel();

                createPanelToggleButton();

                showPanel();


                document.addEventListener(
                    'pointerdown',
                    handleOutsidePanelPointerDown,
                    true
                );


                map.on(
                    'resize',
                    resizeCanvas
                );


                map.on(
                    'movestart zoomstart',
                    stopAnimation
                );


                map.on(
                    'moveend zoomend',
                    onMapSettled
                );


                resizeCanvas();


                if (

                    dataset

                    &&

                    weather

                ) {

                    updatePanel();

                    startAnimation();

                } else {

                    loadWeather(
                        {
                            resetSelection:
                                true
                        }
                    );

                }


                               if (
                    !marineDataset
                ) {

                    loadMarine();

                }


                loadAlerts();


                startRefreshTimer();

            },


            onRemove() {

                active =
                    false;


                stopAnimation();

                stopRefreshTimer();

                clearSearchTimer();


                weatherAbortController
                    ?.abort();


                marineAbortController
                    ?.abort();


                searchAbortController
                    ?.abort();

                
                alertAbortController
                    ?.abort();
                


                document.removeEventListener(
                    'pointerdown',
                    handleOutsidePanelPointerDown,
                    true
                );


                if (map) {

                    map.off(
                        'resize',
                        resizeCanvas
                    );


                    map.off(
                        'movestart zoomstart',
                        stopAnimation
                    );


                    map.off(
                        'moveend zoomend',
                        onMapSettled
                    );

                }


                canvas
                    ?.remove();


                panel
                    ?.remove();


                panelToggleButton
                    ?.remove();


                canvas =
                    null;


                ctx =
                    null;


                panel =
                    null;


                panelToggleButton =
                    null;


                particles =
                    [];

            }

        });


    /* ==========================================================
       INIT
       ========================================================== */

    function init() {

        if (

            !window.map

            ||

            typeof window.map.addLayer !==
                'function'

        ) {

            console.warn(
                '[WindCrotone] window.map non disponibile.'
            );

            return;

        }


        if (

            !window.layerControl

            ||

            typeof window.layerControl.addOverlay !==
                'function'

        ) {

            console.warn(
                '[WindCrotone] layerControl non disponibile.'
            );

            return;

        }


        const layer =
            new WindLayer();


        window.windCrotoneLayer =
            layer;


        window.layerControl.addOverlay(
            layer,
            'Meteo, mare e vento'
        );


        console.info(
            '[WindCrotone] layer meteo + mare + vento provinciale registrato.'
        );

    }


    /* ==========================================================
       PUBLIC API
       ========================================================== */

    window.WindCrotone = {

        reload() {

            if (active) {

                loadWeather();

                loadMarine();

            }

        },


        showPanel() {

            showPanel();

            updatePanel();

        },


        hidePanel() {

            hidePanel();

        },


        togglePanel() {

            if (!panel) {

                return;

            }


            if (
                panel
                    .classList
                    .contains(
                        'is-hidden'
                    )
            ) {

                showPanel();

                updatePanel();

            } else {

                hidePanel();

            }

        },


        setLocation(
            name,
            lat,
            lng
        ) {

            selectLocation(
                {
                    name,

                    label:
                        name,

                    lat,

                    lng
                }
            );

        },


        setView(
            view
        ) {

            if (
                ![
                    'weather',
                    'marine',
                    'fishing'
                ]
                .includes(
                    view
                )
            ) {

                return;

            }


            activeView =
                view;


            updatePanel();

        },



        setTimeMode(
            mode
        ) {

            setTimeMode(
                mode
            );

        },




        getState() {

            return {

                active,

                loaded:
                    !!dataset,

                marineLoaded:
                    !!marineDataset,

                marineAvailable:

                    marineDataset
                        ?.available

                    ??

                    false,

                view:
                    activeView,

                location: {

                    ...currentLocation

                },

                frame:
                    selectedFrameId,

                                day:
                    selectedDayDate,

                dayAnchor:
                    selectedDayAnchorDate,

                timeMode,

                panelVisible:

                    !!panel

                    &&

                    !panel
                        .classList
                        .contains(
                            'is-hidden'
                        ),

                stale:

                    dataset
                        ?.stale

                    ??

                    false,

                marineStale:

                    marineDataset
                        ?.stale

                    ??

                    false

            };

        }

    };


    init();

})();
