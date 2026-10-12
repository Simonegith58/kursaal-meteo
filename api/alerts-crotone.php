<?php
declare(strict_types=1);

/*
 * Crotone Local Guide
 * Allerte DPC
 *
 * BUILD v1.1
 * Parser GeoJSON strutturato
 *
 * Endpoint pubblico:
 * /api/alerts-crotone.php
 *
 * Cache privata:
 * /_private/weather-alerts/
 */

const ALERT_SOURCE_URL =
    'https://mappe.protezionecivile.gov.it/it/mappe-rischi/bollettino-di-criticita/index.html';

const ALERT_GEOJSON_BASE =
    'https://raw.githubusercontent.com/pcm-dpc/DPC-Bollettini-Criticita-Idrogeologica-Idraulica/master/files/geojson/';

const ALERT_TARGET_ZONE_CODE =
    'Cala-6';

const ALERT_TARGET_ZONE_NAME =
    'Versante Jonico Centro-settentrionale';

const ALERT_TARGET_CITY =
    'Crotone';

const ALERT_CACHE_TTL_SECONDS =
    600; // 10 minuti

const ALERT_MAX_STALE_SECONDS =
    21600; // 6 ore

const ALERT_CONNECT_TIMEOUT_SECONDS =
    4;

const ALERT_TOTAL_TIMEOUT_SECONDS =
    12;

const ALERT_MAX_HTML_BYTES =
    2097152; // 2 MiB

const ALERT_MAX_GEOJSON_BYTES =
    8388608; // 8 MiB hard cap

const ALERT_MAX_FEATURES =
    500;

const ALERT_ALLOWED_LEVELS = [
    'none',
    'yellow',
    'orange',
    'red',
    'unavailable'
];


$timezone =
    new DateTimeZone(
        'Europe/Rome'
    );

$now =
    new DateTimeImmutable(
        'now',
        $timezone
    );


/* =========================================================
   HEADER HTTP
   ========================================================= */

header(
    'Content-Type: application/json; charset=utf-8'
);

header(
    'X-Content-Type-Options: nosniff'
);

header(
    'Cache-Control: public, max-age=120'
);

header(
    'Referrer-Policy: no-referrer'
);


/* =========================================================
   METODO HTTP
   ========================================================= */

if (
    ($_SERVER['REQUEST_METHOD'] ?? 'GET')
    !==
    'GET'
) {

    header(
        'Allow: GET'
    );

    jsonResponse(
        [
            'ok' => false,
            'error' => 'method_not_allowed'
        ],
        405
    );
}


/*
 * L'endpoint non accetta parametri.
 */
if (
    !empty($_GET)
) {

    jsonResponse(
        [
            'ok' => false,
            'error' => 'unexpected_parameters'
        ],
        400
    );
}


/* =========================================================
   DIPENDENZE
   ========================================================= */

if (
    !extension_loaded('curl')
    ||
    !class_exists(DOMDocument::class)
) {

    jsonResponse(
        [
            'ok' => false,
            'error' => 'server_dependency_missing'
        ],
        503
    );
}


/* =========================================================
   DIRECTORY
   ========================================================= */

$documentRoot =
    rtrim(
        (string)(
            $_SERVER['DOCUMENT_ROOT']
            ??
            ''
        ),
        DIRECTORY_SEPARATOR
    );

if (
    $documentRoot === ''
    ||
    !is_dir($documentRoot)
) {

    jsonResponse(
        [
            'ok' => false,
            'error' => 'server_config_error'
        ],
        503
    );
}


$privateDir =
    $documentRoot
    .
    DIRECTORY_SEPARATOR
    .
    '_private'
    .
    DIRECTORY_SEPARATOR
    .
    'weather-alerts';


/*
 * Usiamo una cache diversa dalla v1,
 * così non possiamo leggere accidentalmente
 * dati prodotti dal vecchio parser HTML.
 */
$cacheFile =
    $privateDir
    .
    DIRECTORY_SEPARATOR
    .
    'current-v2.json';


$lockFile =
    $privateDir
    .
    DIRECTORY_SEPARATOR
    .
    'refresh.lock';


if (
    !is_dir($privateDir)
    ||
    !is_writable($privateDir)
) {

    jsonResponse(
        [
            'ok' => false,
            'error' => 'server_cache_unavailable'
        ],
        503
    );
}


/* =========================================================
   CACHE FRESCA
   ========================================================= */

$cached =
    readJsonFile(
        $cacheFile
    );


if (
    $cached !== null
    &&
    !validateCachedPayload(
        $cached,
        $now
    )
) {

    $cached =
        null;
}



if (
    $cached !== null
    &&
    isFreshCache($cacheFile)
    &&
    payloadContainsDate(
        $cached,
        $now->format('Y-m-d')
    )
) {

    header(
        'X-Weather-Alerts-Cache: HIT'
    );

    jsonResponse(
        $cached
    );
}


/* =========================================================
   LOCK
   ========================================================= */

$lockHandle =
    @fopen(
        $lockFile,
        'c'
    );


if (
    $lockHandle === false
) {

    serveStaleOrFail(
        $cached,
        $cacheFile,
        $now
    );
}


if (
    !flock(
        $lockHandle,
        LOCK_EX | LOCK_NB
    )
) {

    fclose(
        $lockHandle
    );

    serveStaleOrFail(
        $cached,
        $cacheFile,
        $now
    );
}


/* =========================================================
   AGGIORNAMENTO
   ========================================================= */

try {

    /*
     * Double check dopo aver acquisito il lock.
     */
    $cachedAfterLock =
        readJsonFile(
            $cacheFile
        );

if (
    $cachedAfterLock !== null
    &&
    !validateCachedPayload(
        $cachedAfterLock,
        $now
    )
) {

    $cachedAfterLock =
        null;
}

    if (
        $cachedAfterLock !== null
        &&
        isFreshCache($cacheFile)
        &&
        payloadContainsDate(
            $cachedAfterLock,
            $now->format('Y-m-d')
        )
    ) {

        flock(
            $lockHandle,
            LOCK_UN
        );

        fclose(
            $lockHandle
        );

        header(
            'X-Weather-Alerts-Cache: HIT'
        );

        jsonResponse(
            $cachedAfterLock
        );
    }


    /*
     * 1.
     * Leggiamo esclusivamente la pagina ufficiale DPC.
     */
    $html =
        fetchLimited(
            ALERT_SOURCE_URL,
            'mappe.protezionecivile.gov.it',
            ALERT_MAX_HTML_BYTES,
            [
                'text/html',
                'application/xhtml+xml'
            ],
            '/it/mappe-rischi/bollettino-di-criticita/'
        );


    /*
     * 2.
     * Dal titolo ricaviamo:
     *
     * - data pubblicazione
     * - ora pubblicazione
     * - ID canonico YYYYMMDD_HHMM
     */
    $bulletin =
        parseBulletinMetadata(
            $html,
            $now
        );


    $bulletinDate =
        DateTimeImmutable::createFromFormat(
            '!Ymd',
            substr(
                $bulletin['id'],
                0,
                8
            ),
            $timezone
        );


    if (
        $bulletinDate === false
    ) {

        throw new RuntimeException(
            'bulletin_date_invalid'
        );
    }


    $currentDate =
        $now->format(
            'Y-m-d'
        );


    $yesterdayDate =
        $now
            ->modify('-1 day')
            ->format('Y-m-d');


    $publicationDate =
        $bulletinDate->format(
            'Y-m-d'
        );


    /*
     * Se il bollettino è stato pubblicato oggi,
     * leggiamo today + tomorrow.
     *
     * Se siamo dopo mezzanotte e il bollettino
     * corrente è ancora quello di ieri,
     * ci serve soltanto "tomorrow", che per noi
     * corrisponde alla data odierna.
     */
    if (
        $publicationDate
        ===
        $currentDate
    ) {

        $phases = [

            'today' =>
                $bulletinDate->format(
                    'Y-m-d'
                ),

            'tomorrow' =>
                $bulletinDate
                    ->modify('+1 day')
                    ->format('Y-m-d')

        ];

    }
    elseif (
        $publicationDate
        ===
        $yesterdayDate
    ) {

        $phases = [

            'tomorrow' =>
                $currentDate

        ];

    }
    else {

        throw new RuntimeException(
            'bulletin_date_out_of_range'
        );
    }


    /*
     * 3.
     * Recupero dei GeoJSON strutturati.
     */
    $days =
        [];


    foreach (
        $phases
        as
        $phase => $date
    ) {

        $url =
            buildGeojsonUrl(
                $bulletin['id'],
                $phase
            );


        $rawGeojson =
            fetchLimited(
                $url,
                'raw.githubusercontent.com',
                ALERT_MAX_GEOJSON_BYTES,
                [
                    'application/json',
                    'application/geo+json',
                    'text/plain',
                    'application/octet-stream'
                ],
                '/pcm-dpc/DPC-Bollettini-Criticita-Idrogeologica-Idraulica/master/files/geojson/'
            );


        $days[] =
            parseGeojsonDay(
                $rawGeojson,
                $date
            );


        unset(
            $rawGeojson
        );
    }


    /*
     * 4.
     * Costruiamo esclusivamente il nostro
     * contratto JSON normalizzato.
     */
    $payload = [

        'ok' =>
            true,


        'source' => [

            'name' =>
                'Dipartimento della Protezione Civile',

            'url' =>
                ALERT_SOURCE_URL,

            'bulletinId' =>
                $bulletin['id']

        ],


        'zone' => [

            'code' =>
                ALERT_TARGET_ZONE_CODE,

            'name' =>
                ALERT_TARGET_ZONE_NAME

        ],


        'bulletin' => [

            'title' =>
                $bulletin['title'],

            'revision' =>
                $bulletin['revision'],

            'issuedAt' =>
                $bulletin['issuedAt']

        ],


        'generatedAt' =>
            $now->format(
                DATE_ATOM
            ),


        'stale' =>
            false,


        'days' =>
            $days

    ];


    /*
     * Fail closed:
     * il risultato DEVE contenere la data corrente.
     */
    if (
        !payloadContainsDate(
            $payload,
            $currentDate
        )
    ) {

        throw new RuntimeException(
            'payload_does_not_cover_current_date'
        );
    }


    /*
     * 5.
     * Cache soltanto dopo validazione completa.
     */
    atomicWriteJson(
        $cacheFile,
        $payload
    );


    flock(
        $lockHandle,
        LOCK_UN
    );


    fclose(
        $lockHandle
    );


    header(
        'X-Weather-Alerts-Cache: MISS'
    );


    jsonResponse(
        $payload
    );

}
catch (
    Throwable $e
) {

    /*
     * Log standard server.
     */
    error_log(
        'alerts-crotone: '
        .
        $e->getMessage()
    );


    


    flock(
        $lockHandle,
        LOCK_UN
    );


    fclose(
        $lockHandle
    );


    serveStaleOrFail(
        $cached,
        $cacheFile,
        $now
    );
}


/* =========================================================
   COSTRUZIONE URL GEOJSON
   ========================================================= */

function buildGeojsonUrl(
    string $bulletinId,
    string $phase
): string
{

    if (
        !preg_match(
            '/^\d{8}_\d{4}$/D',
            $bulletinId
        )
    ) {

        throw new RuntimeException(
            'bulletin_id_invalid'
        );
    }


    if (
        !in_array(
            $phase,
            [
                'today',
                'tomorrow'
            ],
            true
        )
    ) {

        throw new RuntimeException(
            'bulletin_phase_invalid'
        );
    }


    return
        ALERT_GEOJSON_BASE
        .
        $bulletinId
        .
        '_'
        .
        $phase
        .
        '.json';
}


/* =========================================================
   FETCH LIMITATO
   ========================================================= */

function fetchLimited(
    string $url,
    string $allowedHost,
    int $maxBytes,
    array $allowedContentTypes,
    string $requiredPathPrefix
): string
{

    validateRemoteUrl(
        $url,
        $allowedHost,
        $requiredPathPrefix
    );


    $buffer =
        '';


    $tooLarge =
        false;


    $ch =
        curl_init(
            $url
        );


    if (
        $ch === false
    ) {

        throw new RuntimeException(
            'curl_init_failed'
        );
    }


    curl_setopt_array(
        $ch,
        [

            /*
             * Niente redirect automatici.
             */
            CURLOPT_FOLLOWLOCATION =>
                false,


            CURLOPT_CONNECTTIMEOUT =>
                ALERT_CONNECT_TIMEOUT_SECONDS,


            CURLOPT_TIMEOUT =>
                ALERT_TOTAL_TIMEOUT_SECONDS,


            CURLOPT_SSL_VERIFYPEER =>
                true,


            CURLOPT_SSL_VERIFYHOST =>
                2,


            CURLOPT_USERAGENT =>
                'CrotoneLocalGuide-WeatherAlerts/1.1',


            CURLOPT_HTTPHEADER => [

                'Accept: application/json,application/geo+json,text/html,text/plain;q=0.9,*/*;q=0.1'

            ],


            CURLOPT_WRITEFUNCTION =>

                static function (
                    $curl,
                    string $chunk
                ) use (
                    &$buffer,
                    &$tooLarge,
                    $maxBytes
                ): int {

                    $newLength =
                        strlen($buffer)
                        +
                        strlen($chunk);


                    if (
                        $newLength
                        >
                        $maxBytes
                    ) {

                        $tooLarge =
                            true;

                        return
                            0;
                    }


                    $buffer .=
                        $chunk;


                    return
                        strlen(
                            $chunk
                        );
                }

        ]
    );


    $ok =
        curl_exec(
            $ch
        );


    $status =
        (int)
        curl_getinfo(
            $ch,
            CURLINFO_HTTP_CODE
        );


    $contentType =
        strtolower(
            (string)
            curl_getinfo(
                $ch,
                CURLINFO_CONTENT_TYPE
            )
        );


    $error =
        curl_error(
            $ch
        );


    curl_close(
        $ch
    );


    if (
        $tooLarge
    ) {

        throw new RuntimeException(
            'upstream_response_too_large'
        );
    }


    if (
        $ok === false
        ||
        $status < 200
        ||
        $status >= 300
    ) {

        throw new RuntimeException(
            'upstream_http_error:'
            .
            $status
            .
            ':'
            .
            sanitizeLogValue(
                $error
            )
        );
    }


    if (
        $buffer === ''
    ) {

        throw new RuntimeException(
            'upstream_body_empty'
        );
    }


    if (
        $contentType !== ''
        &&
        !contentTypeAllowed(
            $contentType,
            $allowedContentTypes
        )
    ) {

        throw new RuntimeException(
            'unexpected_content_type:'
            .
            sanitizeLogValue(
                $contentType
            )
        );
    }


    return
        $buffer;
}


/* =========================================================
   ALLOWLIST URL
   ========================================================= */

function validateRemoteUrl(
    string $url,
    string $allowedHost,
    string $requiredPathPrefix
): void
{

    $parts =
        parse_url(
            $url
        );


    if (
        !is_array(
            $parts
        )
    ) {

        throw new RuntimeException(
            'remote_url_invalid'
        );
    }


    $scheme =
        strtolower(
            (string)(
                $parts['scheme']
                ??
                ''
            )
        );


    $host =
        strtolower(
            (string)(
                $parts['host']
                ??
                ''
            )
        );


    $port =
        isset(
            $parts['port']
        )
        ?
        (int)$parts['port']
        :
        null;


    $path =
        (string)(
            $parts['path']
            ??
            ''
        );


    if (
        $scheme !== 'https'
    ) {

        throw new RuntimeException(
            'remote_scheme_rejected'
        );
    }


    if (
        $host
        !==
        strtolower(
            $allowedHost
        )
    ) {

        throw new RuntimeException(
            'remote_host_rejected'
        );
    }


    if (
        $port !== null
        &&
        $port !== 443
    ) {

        throw new RuntimeException(
            'remote_port_rejected'
        );
    }


    if (
        strpos(
            $path,
            $requiredPathPrefix
        )
        !==
        0
    ) {

        throw new RuntimeException(
            'remote_path_rejected'
        );
    }


    if (
        isset($parts['user'])
        ||
        isset($parts['pass'])
        ||
        isset($parts['fragment'])
    ) {

        throw new RuntimeException(
            'remote_url_components_rejected'
        );
    }
}


/* =========================================================
   CONTENT TYPE
   ========================================================= */

function contentTypeAllowed(
    string $contentType,
    array $allowed
): bool
{

    foreach (
        $allowed
        as
        $prefix
    ) {

        if (
            strpos(
                $contentType,
                strtolower(
                    $prefix
                )
            )
            ===
            0
        ) {

            return
                true;
        }
    }


    return
        false;
}


/* =========================================================
   METADATI BOLLETTINO
   ========================================================= */

function parseBulletinMetadata(
    string $html,
    DateTimeImmutable $now
): array
{

    $dom =
        new DOMDocument();


    $previous =
        libxml_use_internal_errors(
            true
        );


    $loaded =
        $dom->loadHTML(
            $html,
            LIBXML_NONET
            |
            LIBXML_NOERROR
            |
            LIBXML_NOWARNING
        );


    libxml_clear_errors();


    libxml_use_internal_errors(
        $previous
    );


    if (
        !$loaded
    ) {

        throw new RuntimeException(
            'html_parse_failed'
        );
    }


    $xpath =
        new DOMXPath(
            $dom
        );


    $title =
        '';


    $h1Nodes =
        $xpath->query(
            '//h1'
        );


    if (
        $h1Nodes !== false
    ) {

        foreach (
            $h1Nodes
            as
            $h1
        ) {

            $candidate =
                normalizeWhitespace(
                    (string)$h1->textContent
                );


            if (
                stripos(
                    $candidate,
                    'Bollettino di Critic'
                )
                !==
                false
            ) {

                $title =
                    $candidate;

                break;
            }
        }
    }


    if (
        $title === ''
    ) {

        throw new RuntimeException(
            'bulletin_title_missing'
        );
    }


    if (
        !preg_match(
            '/Bollettino\s+di\s+Criticit(?:a|à)\s+del\s+(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\s+(\d{4})/iu',
            $title,
            $dateMatch
        )
    ) {

        throw new RuntimeException(
            'bulletin_date_missing'
        );
    }


    if (
        !preg_match(
            '/(?:delle\s+ore|ore)\s+(\d{1,2}):(\d{2})/iu',
            $title,
            $timeMatch
        )
    ) {

        throw new RuntimeException(
            'bulletin_time_missing'
        );
    }


    $months =
        italianMonths();


    $monthName =
        strtolower(
            $dateMatch[2]
        );


    if (
        !isset(
            $months[$monthName]
        )
    ) {

        throw new RuntimeException(
            'bulletin_month_invalid'
        );
    }


    $dateString =
        sprintf(
            '%04d-%02d-%02d %02d:%02d',
            (int)$dateMatch[3],
            $months[$monthName],
            (int)$dateMatch[1],
            (int)$timeMatch[1],
            (int)$timeMatch[2]
        );


    $issuedAt =
        DateTimeImmutable::createFromFormat(
            '!Y-m-d H:i',
            $dateString,
            new DateTimeZone(
                'Europe/Rome'
            )
        );


    if (
        $issuedAt === false
    ) {

        throw new RuntimeException(
            'bulletin_datetime_invalid'
        );
    }


    /*
     * Evitiamo timestamp palesemente futuri.
     */
    if (
        $issuedAt
        >
        $now->modify(
            '+15 minutes'
        )
    ) {

        throw new RuntimeException(
            'bulletin_datetime_in_future'
        );
    }


    $id =
        $issuedAt->format(
            'Ymd_Hi'
        );


    if (
        !preg_match(
            '/^\d{8}_\d{4}$/D',
            $id
        )
    ) {

        throw new RuntimeException(
            'bulletin_id_invalid'
        );
    }


    /*
     * Verifica aggiuntiva:
     * l'ID costruito dal titolo deve essere
     * presente nella pagina ufficiale.
     */
    if (
        strpos(
            $html,
            $id
        )
        ===
        false
    ) {

        throw new RuntimeException(
            'bulletin_id_not_found_in_source'
        );
    }


    $revision =
        'standard';


    if (
        stripos(
            $title,
            'errata corrige'
        )
        !==
        false
    ) {

        $revision =
            'errata_corrige';

    }
    elseif (
        stripos(
            $title,
            'aggiornamento'
        )
        !==
        false
    ) {

        $revision =
            'aggiornamento';
    }


    return [

        'id' =>
            $id,

        'title' =>
            $title,

        'revision' =>
            $revision,

        'issuedAt' =>
            $issuedAt->format(
                DATE_ATOM
            )

    ];
}


/* =========================================================
   PARSER GEOJSON
   ========================================================= */

function parseGeojsonDay(
    string $raw,
    string $date
): array
{

    try {

        $geojson =
            json_decode(
                $raw,
                true,
                128,
                JSON_THROW_ON_ERROR
            );

    }
    catch (
        JsonException $e
    ) {

        throw new RuntimeException(
            'geojson_decode_failed'
        );
    }


    if (
        !is_array(
            $geojson
        )
        ||
        ($geojson['type'] ?? null)
        !==
        'FeatureCollection'
    ) {

        throw new RuntimeException(
            'geojson_type_invalid'
        );
    }


    $features =
        $geojson['features']
        ??
        null;


    if (
        !is_array(
            $features
        )
    ) {

        throw new RuntimeException(
            'geojson_features_missing'
        );
    }


    $featureCount =
        count(
            $features
        );


    if (
        $featureCount < 1
        ||
        $featureCount
        >
        ALERT_MAX_FEATURES
    ) {

        throw new RuntimeException(
            'geojson_feature_count_invalid'
        );
    }


    /*
     * Troviamo soltanto la zona esatta.
     */
    $candidates =
        [];


    foreach (
        $features
        as
        $feature
    ) {

        if (
            !is_array(
                $feature
            )
        ) {

            continue;
        }


        $properties =
            $feature['properties']
            ??
            null;


        if (
            !is_array(
                $properties
            )
        ) {

            continue;
        }


        $zoneNameRaw =
            $properties['Nome zona']
            ??
            null;


        if (
            !is_string(
                $zoneNameRaw
            )
        ) {

            continue;
        }


        if (
            normalizeWhitespace(
                $zoneNameRaw
            )
            !==
            ALERT_TARGET_ZONE_NAME
        ) {

            continue;
        }


        /*
         * Se il GeoJSON fornisce Comuni,
         * verifichiamo anche Crotone.
         */
        if (
            !cityMatchesIfPresent(
                $properties,
                ALERT_TARGET_CITY
            )
        ) {

            continue;
        }


        $candidates[] =
            $properties;
    }


    if (
        $candidates === []
    ) {

        throw new RuntimeException(
            'target_zone_not_found'
        );
    }


    $parsedCandidates =
        [];


    foreach (
        $candidates
        as
        $properties
    ) {

        $levels = [

            'hydraulic' =>
                parseAlertField(
                    $properties[
                        'Per rischio idraulico'
                    ]
                    ??
                    null
                ),


            'thunderstorm' =>
                parseAlertField(
                    $properties[
                        'Per rischio temporali'
                    ]
                    ??
                    null
                ),


            'hydrogeological' =>
                parseAlertField(
                    $properties[
                        'Per rischio idrogeologico'
                    ]
                    ??
                    null
                )

        ];


        $available =
            [];


        foreach (
            $levels
            as
            $level
        ) {

            if (
                !in_array(
                    $level,
                    ALERT_ALLOWED_LEVELS,
                    true
                )
            ) {

                throw new RuntimeException(
                    'internal_level_invalid'
                );
            }


            if (
                $level
                !==
                'unavailable'
            ) {

                $available[] =
                    $level;
            }
        }


        $maxLevel =
            computeMaxLevel(
                $available
            );


        $complete =
            count(
                $available
            )
            ===
            3;


        /*
         * Controllo incrociato col livello
         * rappresentato sulla mappa.
         */
        $mapLevel =
            parseAlertField(
                $properties[
                    'Rappresentata nella mappa'
                ]
                ??
                null
            );


        if (
            $complete
            &&
            $mapLevel
            !==
            'unavailable'
            &&
            $mapLevel
            !==
            $maxLevel
        ) {

            throw new RuntimeException(
                'map_level_mismatch'
            );
        }


        $parsedCandidates[] = [

            'hydraulic' =>
                $levels[
                    'hydraulic'
                ],

            'thunderstorm' =>
                $levels[
                    'thunderstorm'
                ],

            'hydrogeological' =>
                $levels[
                    'hydrogeological'
                ],

            'maxLevel' =>
                $maxLevel,

            'complete' =>
                $complete,

            'date' =>
                $date

        ];
    }


    /*
     * Se per qualche motivo ci fossero più feature
     * con lo stesso nome, devono produrre
     * esattamente lo stesso risultato.
     */
    $first =
        $parsedCandidates[0];


    foreach (
        $parsedCandidates
        as
        $candidate
    ) {

        if (
            $candidate
            !==
            $first
        ) {

            throw new RuntimeException(
                'ambiguous_target_zone'
            );
        }
    }


    return
        $first;
}


/* =========================================================
   VERIFICA COMUNE
   ========================================================= */

function cityMatchesIfPresent(
    array $properties,
    string $targetCity
): bool
{

    if (
        !array_key_exists(
            'Comuni',
            $properties
        )
    ) {

        return
            true;
    }


    $comuni =
        $properties['Comuni'];


    if (
        $comuni === null
        ||
        $comuni === ''
    ) {

        return
            true;
    }


    if (
        !is_array(
            $comuni
        )
    ) {

        if (
            !is_string(
                $comuni
            )
        ) {

            throw new RuntimeException(
                'comuni_field_invalid'
            );
        }


        $comuni = [
            $comuni
        ];
    }


    foreach (
        $comuni
        as
        $city
    ) {

        if (
            is_string(
                $city
            )
            &&
            strcasecmp(
                normalizeWhitespace(
                    $city
                ),
                $targetCity
            )
            ===
            0
        ) {

            return
                true;
        }
    }


    return
        false;
}


/* =========================================================
   NORMALIZZAZIONE ALLERTA
   ========================================================= */

function parseAlertField(
    $value
): string
{

    if (
        !is_string(
            $value
        )
    ) {

        return
            'unavailable';
    }


    $normalized =
        normalizeWhitespace(
            $value
        );


    if (
        $normalized === ''
    ) {

        return
            'unavailable';
    }


    /*
     * Esempi:
     *
     * Ordinaria / ALLERTA GIALLA
     *
     * Assenza di fenomeni significativi prevedibili
     * / NESSUNA ALLERTA
     */
    $parts =
        preg_split(
            '/\s*\/\s*/u',
            $normalized,
            2
        );


    if (
        !is_array(
            $parts
        )
        ||
        $parts === []
    ) {

        return
            'unavailable';
    }


    $alertPart =
        count(
            $parts
        )
        >
        1
        ?
        $parts[1]
        :
        $parts[0];


    $alertPart =
        strtoupper(
            normalizeWhitespace(
                $alertPart
            )
        );


    $map = [

        'NESSUNA ALLERTA' =>
            'none',

        'ALLERTA GIALLA' =>
            'yellow',

        'ALLERTA ARANCIONE' =>
            'orange',

        'ALLERTA ROSSA' =>
            'red'

    ];


    return
        $map[
            $alertPart
        ]
        ??
        'unavailable';
}


/* =========================================================
   MAX LEVEL
   ========================================================= */

function computeMaxLevel(
    array $levels
): string
{

    if (
        $levels === []
    ) {

        return
            'unavailable';
    }


    $rank = [

        'none' =>
            0,

        'yellow' =>
            1,

        'orange' =>
            2,

        'red' =>
            3

    ];


    $maxLevel =
        'none';


    $maxRank =
        0;


    foreach (
        $levels
        as
        $level
    ) {

        if (
            isset(
                $rank[$level]
            )
            &&
            $rank[$level]
            >
            $maxRank
        ) {

            $maxRank =
                $rank[$level];


            $maxLevel =
                $level;
        }
    }


    return
        $maxLevel;
}


/* =========================================================
   MESI
   ========================================================= */

function italianMonths(): array
{

    return [

        'gennaio' => 1,

        'febbraio' => 2,

        'marzo' => 3,

        'aprile' => 4,

        'maggio' => 5,

        'giugno' => 6,

        'luglio' => 7,

        'agosto' => 8,

        'settembre' => 9,

        'ottobre' => 10,

        'novembre' => 11,

        'dicembre' => 12

    ];
}


/* =========================================================
   NORMALIZZAZIONE TESTO
   ========================================================= */

function normalizeWhitespace(
    string $value
): string
{

    $value =
        html_entity_decode(
            $value,
            ENT_QUOTES
            |
            ENT_HTML5,
            'UTF-8'
        );


    $value =
        preg_replace(
            '/\s+/u',
            ' ',
            $value
        )
        ??
        '';


    return
        trim(
            $value
        );
}


/* =========================================================
   CACHE
   ========================================================= */

function payloadContainsDate(
    array $payload,
    string $date
): bool
{

    if (
        ($payload['ok'] ?? false)
        !==
        true
        ||
        !isset(
            $payload['days']
        )
        ||
        !is_array(
            $payload['days']
        )
    ) {

        return
            false;
    }


    foreach (
        $payload['days']
        as
        $day
    ) {

        if (
            is_array(
                $day
            )
            &&
            ($day['date'] ?? null)
            ===
            $date
        ) {

            return
                true;
        }
    }


    return
        false;
}



function validateCachedPayload(
    array $payload,
    DateTimeImmutable $now
): bool
{

    /*
     * Struttura principale.
     */
    if (
        ($payload['ok'] ?? null) !== true
        ||
        !isset($payload['source'])
        ||
        !is_array($payload['source'])
        ||
        !isset($payload['zone'])
        ||
        !is_array($payload['zone'])
        ||
        !isset($payload['bulletin'])
        ||
        !is_array($payload['bulletin'])
        ||
        !isset($payload['days'])
        ||
        !is_array($payload['days'])
    ) {

        return false;
    }


    /*
     * Fonte.
     */
    if (
        ($payload['source']['name'] ?? null)
        !==
        'Dipartimento della Protezione Civile'
        ||
        ($payload['source']['url'] ?? null)
        !==
        ALERT_SOURCE_URL
    ) {

        return false;
    }


    $bulletinId =
        $payload['source']['bulletinId']
        ??
        null;


    if (
        !is_string($bulletinId)
        ||
        !preg_match(
            '/^\d{8}_\d{4}$/D',
            $bulletinId
        )
    ) {

        return false;
    }


    /*
     * Zona.
     */
    if (
        ($payload['zone']['code'] ?? null)
        !==
        ALERT_TARGET_ZONE_CODE
        ||
        ($payload['zone']['name'] ?? null)
        !==
        ALERT_TARGET_ZONE_NAME
    ) {

        return false;
    }


    /*
     * Bollettino.
     */
    $title =
        $payload['bulletin']['title']
        ??
        null;


    $revision =
        $payload['bulletin']['revision']
        ??
        null;


    $issuedAt =
        $payload['bulletin']['issuedAt']
        ??
        null;


    if (
        !is_string($title)
        ||
        $title === ''
        ||
        strlen($title) > 500
    ) {

        return false;
    }


    if (
        !in_array(
            $revision,
            [
                'standard',
                'errata_corrige',
                'aggiornamento'
            ],
            true
        )
    ) {

        return false;
    }


    if (
        !is_string($issuedAt)
        ||
        DateTimeImmutable::createFromFormat(
            'Y-m-d\TH:i:sP',
            $issuedAt
        ) === false
    ) {

        return false;
    }


    /*
     * generatedAt.
     */
    $generatedAt =
        $payload['generatedAt']
        ??
        null;


    if (
        !is_string($generatedAt)
    ) {

        return false;
    }


    $generatedDate =
        DateTimeImmutable::createFromFormat(
            'Y-m-d\TH:i:sP',
            $generatedAt
        );


    if (
        $generatedDate === false
        ||
        $generatedDate
        >
        $now->modify('+15 minutes')
    ) {

        return false;
    }


    /*
     * La cache su disco deve essere quella originale.
     *
     * stale=true viene aggiunto soltanto
     * alla copia restituita al browser.
     */
    if (
        ($payload['stale'] ?? null)
        !==
        false
    ) {

        return false;
    }


    /*
     * Giorni.
     *
     * Il nostro endpoint produce normalmente
     * una o due giornate.
     */
    $days =
        $payload['days'];


    if (
        count($days) < 1
        ||
        count($days) > 2
    ) {

        return false;
    }


    $seenDates =
        [];


    foreach (
        $days
        as
        $day
    ) {

        if (
            !is_array($day)
        ) {

            return false;
        }


        $date =
            $day['date']
            ??
            null;


        if (
            !is_string($date)
            ||
            !preg_match(
                '/^\d{4}-\d{2}-\d{2}$/D',
                $date
            )
        ) {

            return false;
        }


        $dateObject =
            DateTimeImmutable::createFromFormat(
                '!Y-m-d',
                $date,
                new DateTimeZone('Europe/Rome')
            );


        if (
            $dateObject === false
            ||
            $dateObject->format('Y-m-d')
            !==
            $date
        ) {

            return false;
        }


        /*
         * Niente date duplicate.
         */
        if (
            isset(
                $seenDates[$date]
            )
        ) {

            return false;
        }


        $seenDates[$date] =
            true;


        $levels = [

            $day['hydraulic']
            ??
            null,

            $day['thunderstorm']
            ??
            null,

            $day['hydrogeological']
            ??
            null

        ];


        foreach (
            $levels
            as
            $level
        ) {

            if (
                !is_string($level)
                ||
                !in_array(
                    $level,
                    ALERT_ALLOWED_LEVELS,
                    true
                )
            ) {

                return false;
            }
        }


        /*
         * complete deve essere booleano.
         */
        if (
            !array_key_exists(
                'complete',
                $day
            )
            ||
            !is_bool(
                $day['complete']
            )
        ) {

            return false;
        }


        $expectedComplete =
            !in_array(
                'unavailable',
                $levels,
                true
            );


        if (
            $day['complete']
            !==
            $expectedComplete
        ) {

            return false;
        }


        /*
         * Ricalcoliamo maxLevel.
         * Non ci fidiamo del valore salvato.
         */
        $available =
            array_values(
                array_filter(
                    $levels,
                    static function (
                        string $value
                    ): bool {

                        return
                            $value
                            !==
                            'unavailable';
                    }
                )
            );


        $expectedMax =
            computeMaxLevel(
                $available
            );


        if (
            !isset(
                $day['maxLevel']
            )
            ||
            !is_string(
                $day['maxLevel']
            )
            ||
            $day['maxLevel']
            !==
            $expectedMax
        ) {

            return false;
        }
    }


    return true;
}



function isFreshCache(
    string $cacheFile
): bool
{

    if (
        !is_file(
            $cacheFile
        )
    ) {

        return
            false;
    }


    $mtime =
        filemtime(
            $cacheFile
        );


    return

        $mtime !== false

        &&

        (
            time()
            -
            $mtime
        )

        <=

        ALERT_CACHE_TTL_SECONDS;
}


function serveStaleOrFail(
    ?array $cached,
    string $cacheFile,
    DateTimeImmutable $now
): void
{

    if (
        $cached !== null
        &&
        is_file(
            $cacheFile
        )
    ) {

        $mtime =
            filemtime(
                $cacheFile
            );


        $age =

            $mtime === false

            ?

            PHP_INT_MAX

            :

            time()
            -
            $mtime;


        if (
            $age
            <=
            ALERT_MAX_STALE_SECONDS
            &&
            payloadContainsDate(
                $cached,
                $now->format(
                    'Y-m-d'
                )
            )
        ) {

            $cached['stale'] =
                true;


            $cached['servedAt'] =
                $now->format(
                    DATE_ATOM
                );


            header(
                'X-Weather-Alerts-Cache: STALE'
            );


            jsonResponse(
                $cached
            );
        }
    }


    jsonResponse(
        [
            'ok' =>
                false,

            'error' =>
                'alert_data_unavailable'
        ],
        503
    );
}


/* =========================================================
   LETTURA CACHE
   ========================================================= */

function readJsonFile(
    string $path
): ?array
{

    if (
        !is_file(
            $path
        )
    ) {

        return
            null;
    }


    $raw =
        @file_get_contents(
            $path
        );


    if (
        $raw === false
        ||
        $raw === ''
        ||
        strlen(
            $raw
        )
        >
        262144
    ) {

        return
            null;
    }


    try {

        $decoded =
            json_decode(
                $raw,
                true,
                64,
                JSON_THROW_ON_ERROR
            );

    }
    catch (
        JsonException $e
    ) {

        return
            null;
    }


    return

        is_array(
            $decoded
        )

        ?

        $decoded

        :

        null;
}


/* =========================================================
   SCRITTURA CACHE
   ========================================================= */

function atomicWriteJson(
    string $path,
    array $data
): void
{

    $json =
        json_encode(
            $data,
            JSON_UNESCAPED_SLASHES
            |
            JSON_UNESCAPED_UNICODE
            |
            JSON_THROW_ON_ERROR
        );


    $tmp =
        tempnam(
            dirname(
                $path
            ),
            'alerts_'
        );


    if (
        $tmp === false
    ) {

        throw new RuntimeException(
            'cache_temp_create_failed'
        );
    }


    try {

        $written =
            file_put_contents(
                $tmp,
                $json,
                LOCK_EX
            );


        if (
            $written === false
            ||
            $written
            !==
            strlen(
                $json
            )
        ) {

            throw new RuntimeException(
                'cache_write_failed'
            );
        }


        @chmod(
            $tmp,
            0600
        );


        if (
            !rename(
                $tmp,
                $path
            )
        ) {

            throw new RuntimeException(
                'cache_rename_failed'
            );
        }

    }
    finally {

        if (
            is_file(
                $tmp
            )
        ) {

            @unlink(
                $tmp
            );
        }
    }
}


/* =========================================================
   SANITIZZAZIONE LOG
   ========================================================= */

function sanitizeLogValue(
    string $value
): string
{

    $value =
        preg_replace(
            '/[^A-Za-z0-9 ._:\\/-]/',
            '_',
            $value
        )
        ??
        '';


    return
        substr(
            $value,
            0,
            180
        );
}


/* =========================================================
   RISPOSTA JSON
   ========================================================= */

function jsonResponse(
    array $payload,
    int $status = 200
): void
{

    http_response_code(
        $status
    );


    try {

        echo
            json_encode(
                $payload,
                JSON_UNESCAPED_SLASHES
                |
                JSON_UNESCAPED_UNICODE
                |
                JSON_THROW_ON_ERROR
            );

    }
    catch (
        JsonException $e
    ) {

        http_response_code(
            500
        );


        echo
            '{"ok":false,"error":"json_encoding_error"}';
    }


    exit;
}
