<?php

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('Cache-Control: public, max-age=300');


/* ============================================================
   CROTONE LOCAL GUIDE
   RICERCA LOCALITÀ - PROVINCIA DI CROTONE

   Open-Meteo Geocoding API

   - solo GET
   - solo Italia
   - filtro Provincia di Crotone
   - cache server-side
   - endpoint remoto fisso
   ============================================================ */


const CACHE_SECONDS = 3600;

const MAX_RESULTS = 12;

const ALLOW_FREE_EVALUATION = true;


/* ============================================================
   JSON
   ============================================================ */

function jsonResponse(
    array $data,
    int $status = 200
): never {

    http_response_code($status);

    echo json_encode(
        $data,
        JSON_UNESCAPED_UNICODE |
        JSON_UNESCAPED_SLASHES
    );

    exit;
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
            'ok' => false,
            'error' => 'method_not_allowed'
        ],
        405
    );
}


/* ============================================================
   INPUT
   ============================================================ */

$query =

    trim(
        (string)(
            $_GET['q']
            ?? ''
        )
    );


$queryLength =

    function_exists('mb_strlen')

        ?

        mb_strlen(
            $query,
            'UTF-8'
        )

        :

        strlen(
            $query
        );


if (
    $queryLength < 2
    ||
    $queryLength > 80
) {

    jsonResponse(
        [
            'ok' => false,
            'error' => 'invalid_query'
        ],
        400
    );
}


/* ============================================================
   NORMALIZZAZIONE
   ============================================================ */

function lowerText(
    string $value
): string {

    $value =
        trim(
            $value
        );


    if (
        function_exists(
            'mb_strtolower'
        )
    ) {

        return mb_strtolower(
            $value,
            'UTF-8'
        );

    }


    return strtolower(
        $value
    );
}


/* ============================================================
   CONTROLLO PROVINCIA

   Open-Meteo / GeoNames restituisce admin2.

   Accettiamo:
   - Crotone
   - Provincia di Crotone
   - eventuali varianti contenenti "crotone"
   ============================================================ */

function belongsToCrotoneProvince(
    array $item
): bool {

    $admin2 =
        lowerText(
            (string)(
                $item['admin2']
                ?? ''
            )
        );


    if (
        $admin2 !== ''
        &&
        str_contains(
            $admin2,
            'crotone'
        )
    ) {

        return true;

    }


    return false;
}


/* ============================================================
   CACHE
   ============================================================ */

$cacheKey =

    sha1(
        lowerText(
            $query
        )
    );


$cacheFile =

    sys_get_temp_dir()

    . DIRECTORY_SEPARATOR

    . 'crotone_geo_'

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
            'X-Crotone-Geocode-Cache: HIT'
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
        'https://customer-geocoding-api.open-meteo.com/v1/search';

} else {

    if (
        !ALLOW_FREE_EVALUATION
    ) {

        jsonResponse(
            [
                'ok' => false,
                'error' => 'geocoding_not_configured'
            ],
            503
        );

    }


    $endpoint =
        'https://geocoding-api.open-meteo.com/v1/search';

}


/* ============================================================
   QUERY REMOTA
   ============================================================ */

$params = [

    'name' =>
        $query,

    'count' =>
        40,

    'language' =>
        'it',

    'format' =>
        'json',

    'countryCode' =>
        'IT'

];


if (
    $apiKey !== ''
) {

    $params['apikey'] =
        $apiKey;

}


$url =

    $endpoint

    . '?'

    . http_build_query(
        $params,
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
            8,

        CURLOPT_SSL_VERIFYPEER =>
            true,

        CURLOPT_SSL_VERIFYHOST =>
            2,

        CURLOPT_HTTPHEADER => [

            'Accept: application/json'

        ],

        CURLOPT_USERAGENT =>
            'CrotoneLocalGuide-Geocoder/1.0'

    ]
);


$body =
    curl_exec(
        $ch
    );


$status =

    (int)curl_getinfo(
        $ch,
        CURLINFO_HTTP_CODE
    );


$error =
    curl_error(
        $ch
    );


curl_close(
    $ch
);


if (

    $body === false

    ||

    $status < 200

    ||

    $status >= 300

) {

    error_log(
        'Crotone geocoder error: '
        . $status
        . ' '
        . $error
    );


    jsonResponse(
        [
            'ok' => false,
            'error' => 'geocoding_upstream_error'
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
            'ok' => false,
            'error' => 'invalid_geocoding_json'
        ],
        502
    );

}


/* ============================================================
   FILTRO PROVINCIA DI CROTONE
   ============================================================ */

$results =
    [];


$seen =
    [];


foreach (
    $decoded['results'] ?? []
    as $item
) {

    if (
        !is_array(
            $item
        )
    ) {

        continue;

    }


    if (
        !belongsToCrotoneProvince(
            $item
        )
    ) {

        continue;

    }


    $lat =

        filter_var(
            $item['latitude'] ?? null,
            FILTER_VALIDATE_FLOAT
        );


    $lng =

        filter_var(
            $item['longitude'] ?? null,
            FILTER_VALIDATE_FLOAT
        );


    if (
        $lat === false
        ||
        $lng === false
    ) {

        continue;

    }


    $name =

        trim(
            (string)(
                $item['name']
                ?? ''
            )
        );


    if (
        $name === ''
    ) {

        continue;

    }


    $admin3 =

        trim(
            (string)(
                $item['admin3']
                ?? ''
            )
        );


    $admin4 =

        trim(
            (string)(
                $item['admin4']
                ?? ''
            )
        );


    /*
     * Etichetta:
     *
     * Le Castella · Isola di Capo Rizzuto
     */

    $detail =
        '';


    if (
        $admin3 !== ''
        &&
        lowerText($admin3)
        !== lowerText($name)
    ) {

        $detail =
            $admin3;

    } elseif (
        $admin4 !== ''
        &&
        lowerText($admin4)
        !== lowerText($name)
    ) {

        $detail =
            $admin4;

    }


    $label =

        $detail !== ''

            ?

            $name
            . ' · '
            . $detail

            :

            $name;


    /*
     * Evita duplicati quasi identici.
     */

    $uniqueKey =

        round(
            (float)$lat,
            4
        )

        . ':'

        . round(
            (float)$lng,
            4
        );


    if (
        isset(
            $seen[$uniqueKey]
        )
    ) {

        continue;

    }


    $seen[$uniqueKey] =
        true;


    $results[] = [

        'id' =>
            isset($item['id'])
                ? (int)$item['id']
                : null,

        'name' =>
            $name,

        'label' =>
            $label,

        'lat' =>
            round(
                (float)$lat,
                6
            ),

        'lng' =>
            round(
                (float)$lng,
                6
            ),

        'admin1' =>
            (string)(
                $item['admin1']
                ?? ''
            ),

        'admin2' =>
            (string)(
                $item['admin2']
                ?? ''
            ),

        'admin3' =>
            $admin3,

        'admin4' =>
            $admin4

    ];


    if (
        count(
            $results
        )
        >=
        MAX_RESULTS
    ) {

        break;

    }

}


/* ============================================================
   RESPONSE
   ============================================================ */

$response = [

    'ok' =>
        true,

    'query' =>
        $query,

    'count' =>
        count(
            $results
        ),

    'results' =>
        $results

];


$json =

    json_encode(
        $response,
        JSON_UNESCAPED_UNICODE |
        JSON_UNESCAPED_SLASHES
    );


if (
    $json === false
) {

    jsonResponse(
        [
            'ok' => false,
            'error' => 'json_encoding_failed'
        ],
        500
    );

}


@file_put_contents(
    $cacheFile,
    $json,
    LOCK_EX
);


header(
    'X-Crotone-Geocode-Cache: MISS'
);


echo $json;
