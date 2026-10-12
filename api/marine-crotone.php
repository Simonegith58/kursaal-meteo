<?php

declare(strict_types=1);

date_default_timezone_set('Europe/Rome');

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('Cache-Control: public, max-age=180');


/* ============================================================
   CROTONE LOCAL GUIDE
   MARINE API - PROVINCIA DI CROTONE

   - moto ondoso
   - swell
   - temperatura superficiale mare
   - corrente
   - livello mare / marea modellistica
   - previsione 3 giorni
   - cache server-side
   - controllo distanza dalla cella marina
   ============================================================ */


const FORECAST_DAYS = 3;

const CACHE_SECONDS = 600;

const STALE_CACHE_SECONDS = 3600;


/* ============================================================
   AREA CONSENTITA
   ============================================================ */

const ALLOWED_LAT_MIN = 38.75;
const ALLOWED_LAT_MAX = 39.55;

const ALLOWED_LNG_MIN = 16.60;
const ALLOWED_LNG_MAX = 17.40;


/*
 * Oltre questa distanza dalla cella marina restituita,
 * la località viene considerata troppo interna per mostrare
 * il dato come se fosse riferito direttamente al luogo.
 */

const MAX_MARINE_DISTANCE_KM = 18.0;


/* ============================================================
   DEFAULT CROTONE
   ============================================================ */

const DEFAULT_LAT = 39.080884;
const DEFAULT_LNG = 17.129137;


/*
 * TRUE:
 * API gratuita Open-Meteo per utilizzo non commerciale.
 */

const ALLOW_FREE_EVALUATION = true;


/* ============================================================
   JSON RESPONSE
   ============================================================ */

function jsonResponse(
    array $data,
    int $status = 200
): never {

    http_response_code(
        $status
    );


    echo json_encode(
        $data,
        JSON_UNESCAPED_UNICODE |
        JSON_UNESCAPED_SLASHES
    );


    exit;

}


/* ============================================================
   NUMERIC
   ============================================================ */

function numericValue(
    mixed $value
): ?float {

    if (
        $value === null
        ||
        !is_numeric(
            $value
        )
    ) {

        return null;

    }


    return (float)$value;

}


/* ============================================================
   DIREZIONE
   ============================================================ */

function normalizeDirection(
    ?float $value
): ?float {

    if (
        $value === null
    ) {

        return null;

    }


    $value =
        fmod(
            $value,
            360.0
        );


    if (
        $value < 0
    ) {

        $value +=
            360.0;

    }


    return $value;

}


/* ============================================================
   DISTANZA HAVERSINE
   ============================================================ */

function haversineKm(
    float $lat1,
    float $lng1,
    float $lat2,
    float $lng2
): float {

    $earthRadiusKm =
        6371.0088;


    $lat1Rad =
        deg2rad(
            $lat1
        );


    $lat2Rad =
        deg2rad(
            $lat2
        );


    $deltaLat =
        deg2rad(
            $lat2 - $lat1
        );


    $deltaLng =
        deg2rad(
            $lng2 - $lng1
        );


    $a =

        sin(
            $deltaLat / 2
        ) ** 2

        +

        cos(
            $lat1Rad
        )

        *

        cos(
            $lat2Rad
        )

        *

        sin(
            $deltaLng / 2
        ) ** 2;


    $c =

        2

        *

        atan2(
            sqrt($a),
            sqrt(1 - $a)
        );


    return
        $earthRadiusKm
        *
        $c;

}


/* ============================================================
   NORMALIZZA FRAME MARINO
   ============================================================ */

function buildMarineFrame(
    array $source
): array {

    return [

        'time' =>

            isset(
                $source['time']
            )

                ?

                (string)$source['time']

                :

                null,


        /* ONDA MEDIA */

        'waveHeightM' =>

            numericValue(
                $source[
                    'wave_height'
                ]
                ?? null
            ),


        'waveDirectionFrom' =>

            normalizeDirection(

                numericValue(
                    $source[
                        'wave_direction'
                    ]
                    ?? null
                )

            ),


        'wavePeriodS' =>

            numericValue(
                $source[
                    'wave_period'
                ]
                ?? null
            ),


        'wavePeakPeriodS' =>

            numericValue(
                $source[
                    'wave_peak_period'
                ]
                ?? null
            ),


        /* ONDA DA VENTO */

        'windWaveHeightM' =>

            numericValue(
                $source[
                    'wind_wave_height'
                ]
                ?? null
            ),


        'windWaveDirectionFrom' =>

            normalizeDirection(

                numericValue(
                    $source[
                        'wind_wave_direction'
                    ]
                    ?? null
                )

            ),


        'windWavePeriodS' =>

            numericValue(
                $source[
                    'wind_wave_period'
                ]
                ?? null
            ),


        /* SWELL */

        'swellWaveHeightM' =>

            numericValue(
                $source[
                    'swell_wave_height'
                ]
                ?? null
            ),


        'swellWaveDirectionFrom' =>

            normalizeDirection(

                numericValue(
                    $source[
                        'swell_wave_direction'
                    ]
                    ?? null
                )

            ),


        'swellWavePeriodS' =>

            numericValue(
                $source[
                    'swell_wave_period'
                ]
                ?? null
            ),


        'swellWavePeakPeriodS' =>

            numericValue(
                $source[
                    'swell_wave_peak_period'
                ]
                ?? null
            ),


        /* TEMPERATURA MARE */

        'seaSurfaceTemperatureC' =>

            numericValue(
                $source[
                    'sea_surface_temperature'
                ]
                ?? null
            ),


        /* CORRENTE */

        'oceanCurrentVelocityKmh' =>

            numericValue(
                $source[
                    'ocean_current_velocity'
                ]
                ?? null
            ),


        'oceanCurrentDirectionTo' =>

            normalizeDirection(

                numericValue(
                    $source[
                        'ocean_current_direction'
                    ]
                    ?? null
                )

            ),


        /* LIVELLO MARE */

        'seaLevelHeightMslM' =>

            numericValue(
                $source[
                    'sea_level_height_msl'
                ]
                ?? null
            )

    ];

}


/* ============================================================
   SOLO GET
   ============================================================ */

if (
    ($_SERVER['REQUEST_METHOD'] ?? 'GET')
    !== 'GET'
) {

    jsonResponse(
        [
            'ok' =>
                false,

            'error' =>
                'method_not_allowed'
        ],
        405
    );

}


/* ============================================================
   COORDINATE
   ============================================================ */

$centerLat =

    isset(
        $_GET['lat']
    )

        ?

        filter_var(
            $_GET['lat'],
            FILTER_VALIDATE_FLOAT
        )

        :

        DEFAULT_LAT;


$centerLng =

    isset(
        $_GET['lng']
    )

        ?

        filter_var(
            $_GET['lng'],
            FILTER_VALIDATE_FLOAT
        )

        :

        DEFAULT_LNG;


if (
    $centerLat === false
    ||
    $centerLng === false
) {

    jsonResponse(
        [
            'ok' =>
                false,

            'error' =>
                'invalid_coordinates'
        ],
        400
    );

}


$centerLat =
    (float)$centerLat;


$centerLng =
    (float)$centerLng;


/* ============================================================
   AREA DI SICUREZZA
   ============================================================ */

if (

    $centerLat <
        ALLOWED_LAT_MIN

    ||

    $centerLat >
        ALLOWED_LAT_MAX

    ||

    $centerLng <
        ALLOWED_LNG_MIN

    ||

    $centerLng >
        ALLOWED_LNG_MAX

) {

    jsonResponse(
        [
            'ok' =>
                false,

            'error' =>
                'location_outside_crotone_area'
        ],
        403
    );

}


/* ============================================================
   CACHE
   ============================================================ */

$cacheIdentity =

    round(
        $centerLat,
        3
    )

    . ':'

    . round(
        $centerLng,
        3
    );


$cacheFile =

    sys_get_temp_dir()

    . DIRECTORY_SEPARATOR

    . 'crotone_marine_v1_'

    . sha1(
        $cacheIdentity
    )

    . '.json';


if (

    is_file(
        $cacheFile
    )

    &&

    (
        time()
        -
        filemtime(
            $cacheFile
        )
    )
    <
    CACHE_SECONDS

) {

    $cached =

        file_get_contents(
            $cacheFile
        );


    if (
        $cached !== false
    ) {

        header(
            'X-Crotone-Marine-Cache: HIT'
        );


        echo $cached;

        exit;

    }

}


/* ============================================================
   ENDPOINT OPEN-METEO
   ============================================================ */

$apiKey =

    trim(
        (string)getenv(
            'OPEN_METEO_API_KEY'
        )
    );


if (
    $apiKey !== ''
) {

    $endpoint =
        'https://customer-marine-api.open-meteo.com/v1/marine';

} else {

    if (
        !ALLOW_FREE_EVALUATION
    ) {

        jsonResponse(
            [
                'ok' =>
                    false,

                'error' =>
                    'marine_service_not_configured'
            ],
            503
        );

    }


    $endpoint =
        'https://marine-api.open-meteo.com/v1/marine';

}


/* ============================================================
   VARIABILI MARINE
   ============================================================ */

$variables =

    implode(
        ',',
        [

            'wave_height',

            'wave_direction',

            'wave_period',

            'wave_peak_period',

            'wind_wave_height',

            'wind_wave_direction',

            'wind_wave_period',

            'swell_wave_height',

            'swell_wave_direction',

            'swell_wave_period',

            'swell_wave_peak_period',

            'sea_surface_temperature',

            'ocean_current_velocity',

            'ocean_current_direction',

            'sea_level_height_msl'

        ]
    );


/* ============================================================
   QUERY
   ============================================================ */

$query = [

    'latitude' =>
        $centerLat,

    'longitude' =>
        $centerLng,

    'current' =>
        $variables,

    'hourly' =>
        $variables,

    'forecast_days' =>
        FORECAST_DAYS,

    'timezone' =>
        'Europe/Rome',

    'length_unit' =>
        'metric',

    'cell_selection' =>
        'sea'

];


if (
    $apiKey !== ''
) {

    $query['apikey'] =
        $apiKey;

}


$url =

    $endpoint

    . '?'

    . http_build_query(
        $query,
        '',
        '&',
        PHP_QUERY_RFC3986
    );


/* ============================================================
   CURL
   ============================================================ */

$ch =
    curl_init();


curl_setopt_array(
    $ch,
    [

        CURLOPT_URL =>
            $url,

        CURLOPT_RETURNTRANSFER =>
            true,

        CURLOPT_FOLLOWLOCATION =>
            false,

        CURLOPT_CONNECTTIMEOUT =>
            4,

        CURLOPT_TIMEOUT =>
            12,

        CURLOPT_SSL_VERIFYPEER =>
            true,

        CURLOPT_SSL_VERIFYHOST =>
            2,

        CURLOPT_HTTPHEADER => [

            'Accept: application/json'

        ],

        CURLOPT_USERAGENT =>
            'CrotoneLocalGuide-Marine/1.0'

    ]
);


$body =
    curl_exec(
        $ch
    );


$httpCode =

    (int)curl_getinfo(
        $ch,
        CURLINFO_HTTP_CODE
    );


$curlError =
    curl_error(
        $ch
    );


curl_close(
    $ch
);


/* ============================================================
   FALLBACK CACHE
   ============================================================ */

if (

    $body === false

    ||

    $httpCode < 200

    ||

    $httpCode >= 300

) {

    if (

        is_file(
            $cacheFile
        )

        &&

        (
            time()
            -
            filemtime(
                $cacheFile
            )
        )
        <
        STALE_CACHE_SECONDS

    ) {

        $cached =

            file_get_contents(
                $cacheFile
            );


        if (
            $cached !== false
        ) {

            $old =

                json_decode(
                    $cached,
                    true
                );


            if (
                is_array(
                    $old
                )
            ) {

                $old['stale'] =
                    true;


                header(
                    'X-Crotone-Marine-Cache: STALE'
                );


                jsonResponse(
                    $old
                );

            }

        }

    }


    error_log(

        'Marine API error: '

        . $httpCode

        . ' '

        . $curlError

    );


    jsonResponse(
        [
            'ok' =>
                false,

            'error' =>
                'marine_upstream_error'
        ],
        502
    );

}


/* ============================================================
   DECODE
   ============================================================ */

try {

    $decoded =

        json_decode(
            $body,
            true,
            512,
            JSON_THROW_ON_ERROR
        );


} catch (
    JsonException $e
) {

    jsonResponse(
        [
            'ok' =>
                false,

            'error' =>
                'invalid_marine_json'
        ],
        502
    );

}


if (
    !is_array(
        $decoded
    )
) {

    jsonResponse(
        [
            'ok' =>
                false,

            'error' =>
                'invalid_marine_format'
        ],
        502
    );

}


/* ============================================================
   COORDINATE CELLA MARINA
   ============================================================ */

$marineLat =

    numericValue(
        $decoded[
            'latitude'
        ]
        ?? null
    );


$marineLng =

    numericValue(
        $decoded[
            'longitude'
        ]
        ?? null
    );


if (
    $marineLat === null
    ||
    $marineLng === null
) {

    jsonResponse(
        [
            'ok' =>
                false,

            'error' =>
                'marine_grid_coordinates_missing'
        ],
        502
    );

}


/* ============================================================
   DISTANZA LOCALITÀ / CELLA MARINA
   ============================================================ */

$distanceKm =

    haversineKm(
        $centerLat,
        $centerLng,
        $marineLat,
        $marineLng
    );


$available =

    $distanceKm
    <=
    MAX_MARINE_DISTANCE_KM;


/* ============================================================
   CURRENT
   ============================================================ */

$currentRaw =

    is_array(
        $decoded[
            'current'
        ]
        ?? null
    )

        ?

        $decoded[
            'current'
        ]

        :

        [];


$current =

    buildMarineFrame(
        $currentRaw
    );


/* ============================================================
   HOURLY
   ============================================================ */

$hourlyRaw =

    is_array(
        $decoded[
            'hourly'
        ]
        ?? null
    )

        ?

        $decoded[
            'hourly'
        ]

        :

        [];


$times =

    is_array(
        $hourlyRaw[
            'time'
        ]
        ?? null
    )

        ?

        $hourlyRaw[
            'time'
        ]

        :

        [];


$frames =
    [];


foreach (
    $times as
    $index => $timeString
) {

    if (
        !is_string(
            $timeString
        )
        ||
        $timeString === ''
    ) {

        continue;

    }


    $row = [

        'time' =>
            $timeString

    ];


    foreach (
        [

            'wave_height',

            'wave_direction',

            'wave_period',

            'wave_peak_period',

            'wind_wave_height',

            'wind_wave_direction',

            'wind_wave_period',

            'swell_wave_height',

            'swell_wave_direction',

            'swell_wave_period',

            'swell_wave_peak_period',

            'sea_surface_temperature',

            'ocean_current_velocity',

            'ocean_current_direction',

            'sea_level_height_msl'

        ]
        as
        $field
    ) {

        $row[
            $field
        ] =

            $hourlyRaw[
                $field
            ][
                $index
            ]

            ?? null;

    }


    $frames[
        $timeString
    ] =

        buildMarineFrame(
            $row
        );

}


/* ============================================================
   RESPONSE
   ============================================================ */

$result = [

    'ok' =>
        true,

    'source' =>
        'Open-Meteo Marine',

    'stale' =>
        false,

    'generatedAt' =>
        gmdate(
            'c'
        ),

    'available' =>
        $available,


    'requestedCenter' => [

        'lat' =>
            round(
                $centerLat,
                6
            ),

        'lng' =>
            round(
                $centerLng,
                6
            )

    ],


    'marinePoint' => [

        'lat' =>
            round(
                $marineLat,
                6
            ),

        'lng' =>
            round(
                $marineLng,
                6
            ),

        'distanceKm' =>
            round(
                $distanceKm,
                1
            )

    ],


    'maxAcceptedDistanceKm' =>
        MAX_MARINE_DISTANCE_KM,


    'current' =>
        $current,


    'frames' =>
        $frames

];


$json =

    json_encode(
        $result,
        JSON_UNESCAPED_UNICODE |
        JSON_UNESCAPED_SLASHES
    );


if (
    $json === false
) {

    jsonResponse(
        [
            'ok' =>
                false,

            'error' =>
                'json_encoding_failed'
        ],
        500
    );

}


/* ============================================================
   CACHE ATOMICA
   ============================================================ */

$tempFile =

    $cacheFile
    . '.tmp';


if (

    file_put_contents(
        $tempFile,
        $json,
        LOCK_EX
    )

    !== false

) {

    @rename(
        $tempFile,
        $cacheFile
    );

}


header(
    'X-Crotone-Marine-Cache: MISS'
);


echo $json;
