<?php

declare(strict_types=1);

date_default_timezone_set('Europe/Rome');

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('Cache-Control: public, max-age=180');


/* ============================================================
   CROTONE LOCAL GUIDE
   WIND + WEATHER API DINAMICA

   - Provincia di Crotone
   - griglia vento 5x5
   - meteo associato allo stesso frame
   - previsione 3 giorni
   - fasce orarie personalizzabili
   - cache server-side
   ============================================================ */


const GRID_ROWS = 5;
const GRID_COLS = 5;


/* ============================================================
   DIMENSIONE GRIGLIA INTORNO ALLA LOCALITÀ
   ============================================================ */

const LAT_HALF_SPAN = 0.1100;
const LNG_HALF_SPAN = 0.1250;


/* ============================================================
   AREA MASSIMA CONSENTITA

   Impedisce l'uso dell'endpoint come proxy meteo generico.
   ============================================================ */

const ALLOWED_LAT_MIN = 38.75;
const ALLOWED_LAT_MAX = 39.55;

const ALLOWED_LNG_MIN = 16.60;
const ALLOWED_LNG_MAX = 17.40;


/* ============================================================
   CROTONE DEFAULT
   ============================================================ */

const DEFAULT_LAT = 39.080884;
const DEFAULT_LNG = 17.129137;


/* ============================================================
   FORECAST
   ============================================================ */

const FORECAST_DAYS = 4;


/*
 * Ore mostrate nel popup.
 */

const DISPLAY_HOURS = [
    0,
    3,
    6,
    8,
    9,
    11,
    14,
    17,
    20,
    23
];


/* ============================================================
   CACHE
   ============================================================ */

const CACHE_SECONDS = 600;


/*
 * TRUE =
 * Free API Open-Meteo per uso non commerciale.
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
   HELPERS
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


function integerValue(
    mixed $value
): ?int {

    if (
        $value === null
        ||
        !is_numeric(
            $value
        )
    ) {

        return null;

    }


    return (int)$value;

}


function normalizeDirection(
    float $value
): float {

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
   INDICE ORARIO PIÙ VICINO

   Serve per associare ad "Adesso"
   la precipitation_probability oraria.
   ============================================================ */

function findClosestTimeIndex(
    array $times,
    string $targetTime,
    DateTimeZone $timezone
): ?int {

    try {

        $target =

            new DateTimeImmutable(
                $targetTime,
                $timezone
            );


    } catch (
        Throwable $e
    ) {

        return null;

    }


    $bestIndex =
        null;


    $bestDistance =
        PHP_INT_MAX;


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


        try {

            $candidate =

                new DateTimeImmutable(
                    $timeString,
                    $timezone
                );


        } catch (
            Throwable $e
        ) {

            continue;

        }


        $distance =

            abs(
                $candidate->getTimestamp()
                -
                $target->getTimestamp()
            );


        if (
            $distance <
            $bestDistance
        ) {

            $bestDistance =
                $distance;


            $bestIndex =
                (int)$index;

        }

    }


    return $bestIndex;

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
   COORDINATE LOCALITÀ
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
   AREA CONSENTITA
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
   BOUNDS DINAMICI
   ============================================================ */

$south =
    $centerLat
    -
    LAT_HALF_SPAN;


$north =
    $centerLat
    +
    LAT_HALF_SPAN;


$west =
    $centerLng
    -
    LNG_HALF_SPAN;


$east =
    $centerLng
    +
    LNG_HALF_SPAN;


/* ============================================================
   GRIGLIA 5 x 5
   ============================================================ */

$latitudes =
    [];


$longitudes =
    [];


$pointsMeta =
    [];


for (
    $row = 0;
    $row < GRID_ROWS;
    $row++
) {

    $lat =

        $south

        +

        (
            ($north - $south)
            *
            $row
            /
            (GRID_ROWS - 1)
        );


    for (
        $col = 0;
        $col < GRID_COLS;
        $col++
    ) {

        $lng =

            $west

            +

            (
                ($east - $west)
                *
                $col
                /
                (GRID_COLS - 1)
            );


        $latitudes[] =

            round(
                $lat,
                6
            );


        $longitudes[] =

            round(
                $lng,
                6
            );


        $pointsMeta[] = [

            'row' =>
                $row,

            'col' =>
                $col,

            'lat' =>
                round(
                    $lat,
                    6
                ),

            'lng' =>
                round(
                    $lng,
                    6
                )

        ];

    }

}


/* ============================================================
   CACHE PER LOCALITÀ
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


$cacheKey =

    sha1(
        $cacheIdentity
    );


$cacheFile =

    sys_get_temp_dir()

    . DIRECTORY_SEPARATOR

    . 'crotone_wind_weather_v5_'

    . $cacheKey

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
            'X-Wind-Weather-Cache: HIT'
        );


        echo $cached;

        exit;

    }

}


/* ============================================================
   OPEN-METEO ENDPOINT
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
        'https://customer-api.open-meteo.com/v1/forecast';

} else {

    if (
        !ALLOW_FREE_EVALUATION
    ) {

        jsonResponse(
            [
                'ok' =>
                    false,

                'error' =>
                    'weather_service_not_configured'
            ],
            503
        );

    }


    $endpoint =
        'https://api.open-meteo.com/v1/forecast';

}


/* ============================================================
   VARIABILI CURRENT

   precipitation_probability resta hourly:
   per Adesso utilizziamo l'ora più vicina.
   ============================================================ */

$currentVariables =

    implode(
        ',',
        [

            'temperature_2m',

            'relative_humidity_2m',

            'apparent_temperature',

            'precipitation',

            'rain',

            'showers',

            'snowfall',

            'weather_code',

            'cloud_cover',

            'pressure_msl',

            'is_day',

            'wind_speed_10m',

            'wind_direction_10m',

            'wind_gusts_10m'

        ]
    );


/* ============================================================
   VARIABILI HOURLY
   ============================================================ */

$hourlyVariables =

    implode(
        ',',
        [

            'temperature_2m',

            'relative_humidity_2m',

            'apparent_temperature',

            'precipitation_probability',

            'precipitation',

            'rain',

            'showers',

            'snowfall',

            'weather_code',

            'cloud_cover',

            'pressure_msl',

            'is_day',

            'wind_speed_10m',

            'wind_direction_10m',

            'wind_gusts_10m'

        ]
    );


/* ============================================================
   QUERY
   ============================================================ */

$query = [

    'latitude' =>

        implode(
            ',',
            $latitudes
        ),


    'longitude' =>

        implode(
            ',',
            $longitudes
        ),


    'current' =>
        $currentVariables,


    'hourly' =>
        $hourlyVariables,


    'forecast_days' =>
        FORECAST_DAYS,


    'temperature_unit' =>
        'celsius',


    'wind_speed_unit' =>
        'kmh',


    'precipitation_unit' =>
        'mm',


    'timezone' =>
        'Europe/Rome'

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

            'CrotoneLocalGuide-WindWeather/5.0'

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
        3600

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
                    'X-Wind-Weather-Cache: STALE'
                );


                jsonResponse(
                    $old
                );

            }

        }

    }


    error_log(

        'Wind/Weather API error: '

        . $httpCode

        . ' '

        . $curlError

    );


    jsonResponse(
        [
            'ok' =>
                false,

            'error' =>
                'weather_upstream_error'
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
                'invalid_weather_json'
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
                'invalid_weather_format'
        ],
        502
    );

}


/* ============================================================
   FRAME ATTUALE
   ============================================================ */

$currentFrame = [

    'label' =>
        'Adesso',

    'time' =>
        null,

    'points' =>
        []

];


$slotDefinitions =
    [];


$dayDefinitions =
    [];


$baseCurrentDateTime =
    null;


$timezone =

    new DateTimeZone(
        'Europe/Rome'
    );


/* ============================================================
   PROCESSA I 25 PUNTI
   ============================================================ */

foreach (
    $pointsMeta
    as
    $index => $meta
) {

    $record =
        $decoded[$index]
        ?? null;


    if (
        !is_array(
            $record
        )
    ) {

        continue;

    }


    $current =
        $record['current']
        ?? null;


    $hourly =
        $record['hourly']
        ?? null;


    if (

        !is_array(
            $current
        )

        ||

        !is_array(
            $hourly
        )

    ) {

        continue;

    }


    $times =
        $hourly['time']
        ?? [];


    $currentTime =

        trim(
            (string)(
                $current['time']
                ?? ''
            )
        );


    if (
        $currentTime === ''
    ) {

        continue;

    }


    /* ========================================================
       DATA BASE
       ======================================================== */

    if (
        $baseCurrentDateTime ===
        null
    ) {

        try {

            $baseCurrentDateTime =

                new DateTimeImmutable(
                    $currentTime,
                    $timezone
                );


        } catch (
            Throwable $e
        ) {

            continue;

        }


        for (
            $dayOffset = 0;
            $dayOffset < FORECAST_DAYS;
            $dayOffset++
        ) {

            $date =

                $baseCurrentDateTime

                    ->setTime(
                        0,
                        0
                    )

                    ->modify(
                        '+'
                        . $dayOffset
                        . ' days'
                    )

                    ->format(
                        'Y-m-d'
                    );


            $dayDefinitions[
                $date
            ] = [

                'date' =>
                    $date,

                'dayOffset' =>
                    $dayOffset

            ];

        }

    }


    /* ========================================================
       CURRENT WIND
       ======================================================== */

    $currentSpeed =

        numericValue(
            $current[
                'wind_speed_10m'
            ]
            ?? null
        );


    $currentDirection =

        numericValue(
            $current[
                'wind_direction_10m'
            ]
            ?? null
        );


    $currentGust =

        numericValue(
            $current[
                'wind_gusts_10m'
            ]
            ?? null
        );


    if (

        $currentSpeed ===
        null

        ||

        $currentDirection ===
        null

    ) {

        continue;

    }


    /* ========================================================
       PRECIPITATION PROBABILITY PER ADESSO
       ======================================================== */

    $closestHourlyIndex =

        findClosestTimeIndex(
            is_array(
                $times
            )
                ?
                $times
                :
                [],
            $currentTime,
            $timezone
        );


    $currentPrecipProbability =
        null;


    if (
        $closestHourlyIndex !==
        null
    ) {

        $currentPrecipProbability =

            numericValue(

                $hourly[
                    'precipitation_probability'
                ][
                    $closestHourlyIndex
                ]

                ?? null

            );

    }


    /* ========================================================
       CURRENT POINT
       ======================================================== */

    $currentFrame['points'][] = [

        'row' =>
            $meta['row'],

        'col' =>
            $meta['col'],

        'lat' =>
            $meta['lat'],

        'lng' =>
            $meta['lng'],


        /* WIND */

        'speedKmh' =>

            round(
                $currentSpeed,
                2
            ),

        'directionFrom' =>

            round(
                normalizeDirection(
                    $currentDirection
                ),
                1
            ),

        'gustKmh' =>

            round(
                $currentGust
                ??
                $currentSpeed,
                2
            ),


        /* WEATHER */

        'temperatureC' =>

            numericValue(
                $current[
                    'temperature_2m'
                ]
                ?? null
            ),

        'apparentTemperatureC' =>

            numericValue(
                $current[
                    'apparent_temperature'
                ]
                ?? null
            ),

        'humidityPct' =>

            numericValue(
                $current[
                    'relative_humidity_2m'
                ]
                ?? null
            ),

        'precipitationProbabilityPct' =>
            $currentPrecipProbability,

        'precipitationMm' =>

            numericValue(
                $current[
                    'precipitation'
                ]
                ?? null
            ),

        'rainMm' =>

            numericValue(
                $current[
                    'rain'
                ]
                ?? null
            ),

        'showersMm' =>

            numericValue(
                $current[
                    'showers'
                ]
                ?? null
            ),

        'snowfallCm' =>

            numericValue(
                $current[
                    'snowfall'
                ]
                ?? null
            ),

        'cloudCoverPct' =>

            numericValue(
                $current[
                    'cloud_cover'
                ]
                ?? null
            ),

        'pressureMslHpa' =>

            numericValue(
                $current[
                    'pressure_msl'
                ]
                ?? null
            ),

        'weatherCode' =>

            integerValue(
                $current[
                    'weather_code'
                ]
                ?? null
            ),

        'isDay' =>

            integerValue(
                $current[
                    'is_day'
                ]
                ?? null
            )

    ];


    if (
        $currentFrame['time'] ===
        null
    ) {

        $currentFrame['time'] =
            $currentTime;

    }


    /* ========================================================
       HOURLY ARRAYS
       ======================================================== */

    $speeds =
        $hourly[
            'wind_speed_10m'
        ]
        ?? [];


    $directions =
        $hourly[
            'wind_direction_10m'
        ]
        ?? [];


    $gusts =
        $hourly[
            'wind_gusts_10m'
        ]
        ?? [];


    $temperatures =
        $hourly[
            'temperature_2m'
        ]
        ?? [];


    $apparentTemperatures =
        $hourly[
            'apparent_temperature'
        ]
        ?? [];


    $humidities =
        $hourly[
            'relative_humidity_2m'
        ]
        ?? [];


    $precipitationProbabilities =
        $hourly[
            'precipitation_probability'
        ]
        ?? [];


    $precipitations =
        $hourly[
            'precipitation'
        ]
        ?? [];


    $rains =
        $hourly[
            'rain'
        ]
        ?? [];


    $showers =
        $hourly[
            'showers'
        ]
        ?? [];


    $snowfalls =
        $hourly[
            'snowfall'
        ]
        ?? [];


    $cloudCovers =
        $hourly[
            'cloud_cover'
        ]
        ?? [];


    $pressures =
        $hourly[
            'pressure_msl'
        ]
        ?? [];


    $weatherCodes =
        $hourly[
            'weather_code'
        ]
        ?? [];


    $isDayValues =
        $hourly[
            'is_day'
        ]
        ?? [];


    /* ========================================================
       DEFINISCE GLI SLOT UNA SOLA VOLTA
       ======================================================== */

    if (

        count(
            $slotDefinitions
        ) === 0

        &&

        $baseCurrentDateTime !==
        null

    ) {

        foreach (
            $times as
            $hourIndex => $timeString
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


            try {

                $forecastTime =

                    new DateTimeImmutable(
                        $timeString,
                        $timezone
                    );


            } catch (
                Throwable $e
            ) {

                continue;

            }


            $forecastDate =

                $forecastTime
                    ->format(
                        'Y-m-d'
                    );


            if (
                !isset(
                    $dayDefinitions[
                        $forecastDate
                    ]
                )
            ) {

                continue;

            }


            $hour =

                (int)$forecastTime
                    ->format(
                        'G'
                    );


            $minute =

                (int)$forecastTime
                    ->format(
                        'i'
                    );


            if (

                $minute !== 0

                ||

                !in_array(
                    $hour,
                    DISPLAY_HOURS,
                    true
                )

            ) {

                continue;

            }


            $dayOffset =

                $dayDefinitions[
                    $forecastDate
                ][
                    'dayOffset'
                ];


            /*
             * Oggi:
             * elimina le ore già trascorse.
             */

            if (

                $dayOffset === 0

                &&

                $forecastTime <=
                    $baseCurrentDateTime

            ) {

                continue;

            }


            $slotKey =

                $forecastTime
                    ->format(
                        'Y-m-d\TH:i'
                    );


            $slotDefinitions[
                $slotKey
            ] = [

                'time' =>
                    $slotKey,

                'date' =>
                    $forecastDate,

                'dayOffset' =>
                    $dayOffset,

                'hour' =>
                    $forecastTime
                        ->format(
                            'H:i'
                        ),

                'hourIndex' =>
                    (int)$hourIndex,

                'points' =>
                    []

            ];

        }

    }


    /* ========================================================
       RIEMPI OGNI FRAME ORARIO
       ======================================================== */

    foreach (
        $slotDefinitions
        as
        &$slot
    ) {

        $hourIndex =
            $slot[
                'hourIndex'
            ];


        $speed =

            numericValue(
                $speeds[
                    $hourIndex
                ]
                ?? null
            );


        $direction =

            numericValue(
                $directions[
                    $hourIndex
                ]
                ?? null
            );


        if (

            $speed === null

            ||

            $direction === null

        ) {

            continue;

        }


        $gust =

            numericValue(
                $gusts[
                    $hourIndex
                ]
                ?? null
            );


        $slot['points'][] = [

            'row' =>
                $meta['row'],

            'col' =>
                $meta['col'],

            'lat' =>
                $meta['lat'],

            'lng' =>
                $meta['lng'],


            /* WIND */

            'speedKmh' =>

                round(
                    $speed,
                    2
                ),

            'directionFrom' =>

                round(
                    normalizeDirection(
                        $direction
                    ),
                    1
                ),

            'gustKmh' =>

                round(
                    $gust
                    ??
                    $speed,
                    2
                ),


            /* WEATHER */

            'temperatureC' =>

                numericValue(
                    $temperatures[
                        $hourIndex
                    ]
                    ?? null
                ),

            'apparentTemperatureC' =>

                numericValue(
                    $apparentTemperatures[
                        $hourIndex
                    ]
                    ?? null
                ),

            'humidityPct' =>

                numericValue(
                    $humidities[
                        $hourIndex
                    ]
                    ?? null
                ),

            'precipitationProbabilityPct' =>

                numericValue(
                    $precipitationProbabilities[
                        $hourIndex
                    ]
                    ?? null
                ),

            'precipitationMm' =>

                numericValue(
                    $precipitations[
                        $hourIndex
                    ]
                    ?? null
                ),

            'rainMm' =>

                numericValue(
                    $rains[
                        $hourIndex
                    ]
                    ?? null
                ),

            'showersMm' =>

                numericValue(
                    $showers[
                        $hourIndex
                    ]
                    ?? null
                ),

            'snowfallCm' =>

                numericValue(
                    $snowfalls[
                        $hourIndex
                    ]
                    ?? null
                ),

            'cloudCoverPct' =>

                numericValue(
                    $cloudCovers[
                        $hourIndex
                    ]
                    ?? null
                ),

            'pressureMslHpa' =>

                numericValue(
                    $pressures[
                        $hourIndex
                    ]
                    ?? null
                ),

            'weatherCode' =>

                integerValue(
                    $weatherCodes[
                        $hourIndex
                    ]
                    ?? null
                ),

            'isDay' =>

                integerValue(
                    $isDayValues[
                        $hourIndex
                    ]
                    ?? null
                )

        ];

    }


    unset(
        $slot
    );

}


/* ============================================================
   VALIDAZIONE GRIGLIA
   ============================================================ */

$minimumPoints =

    (int)ceil(

        GRID_ROWS

        *

        GRID_COLS

        *

        0.70

    );


if (

    count(
        $currentFrame[
            'points'
        ]
    )

    <

    $minimumPoints

) {

    jsonResponse(
        [
            'ok' =>
                false,

            'error' =>
                'insufficient_weather_data'
        ],
        502
    );

}


/* ============================================================
   DAYS
   ============================================================ */

$days =
    [];


foreach (
    $dayDefinitions
    as
    $date => $definition
) {

    $day = [

        'date' =>
            $date,

        'dayOffset' =>
            $definition[
                'dayOffset'
            ],

        'slots' =>
            []

    ];


    foreach (
        $slotDefinitions
        as
        $slot
    ) {

        if (
            $slot['date']
            !==
            $date
        ) {

            continue;

        }


        if (

            count(
                $slot[
                    'points'
                ]
            )

            <

            $minimumPoints

        ) {

            continue;

        }


        $day[
            'slots'
        ][] = [

            'time' =>
                $slot[
                    'time'
                ],

            'hour' =>
                $slot[
                    'hour'
                ],

            'points' =>
                $slot[
                    'points'
                ]

        ];

    }


    $days[] =
        $day;

}


/* ============================================================
   RESPONSE
   ============================================================ */

$result = [

    'ok' =>
        true,

    'source' =>
        'Open-Meteo',

    'stale' =>
        false,

    'generatedAt' =>
        gmdate(
            'c'
        ),

    'center' => [

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

    'rows' =>
        GRID_ROWS,

    'cols' =>
        GRID_COLS,

    'displayHours' =>
        DISPLAY_HOURS,

    'bounds' => [

        'south' =>
            round(
                $south,
                6
            ),

        'north' =>
            round(
                $north,
                6
            ),

        'west' =>
            round(
                $west,
                6
            ),

        'east' =>
            round(
                $east,
                6
            )

    ],

    'current' =>
        $currentFrame,

    'days' =>
        $days

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
    'X-Wind-Weather-Cache: MISS'
);


echo $json;
