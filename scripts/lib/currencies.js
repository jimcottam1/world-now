// Which countries use each currency the European Central Bank publishes a reference rate for.
// Two-letter ISO codes. Only currencies used as everyday money there (not pegged local versions:
// the Falkland Islands pound, for example, is its own currency even though it's tied to sterling).
const USERS = {
    EUR: ['AT', 'BE', 'BG', 'HR', 'CY', 'EE', 'FI', 'FR', 'DE', 'GR', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PT', 'SK', 'SI', 'ES',
        'AD', 'MC', 'SM', 'VA', 'ME', 'XK', 'BL', 'MF', 'PM', 'AX'],
    USD: ['US', 'EC', 'SV', 'PA', 'TL', 'PR', 'GU', 'VI', 'AS', 'MP', 'MH', 'FM', 'PW', 'TC', 'VG', 'BQ'],
    GBP: ['GB', 'IM', 'JE', 'GG'],
    CHF: ['CH', 'LI'],
    DKK: ['DK', 'FO', 'GL'],
    NOK: ['NO'],
    SEK: ['SE'],
    ISK: ['IS'],
    CZK: ['CZ'],
    HUF: ['HU'],
    PLN: ['PL'],
    RON: ['RO'],
    TRY: ['TR'],
    JPY: ['JP'],
    CNY: ['CN'],
    HKD: ['HK'],
    KRW: ['KR'],
    INR: ['IN', 'BT'],
    IDR: ['ID'],
    MYR: ['MY'],
    PHP: ['PH'],
    SGD: ['SG'],
    THB: ['TH'],
    ILS: ['IL', 'PS'],
    AUD: ['AU', 'KI', 'NR', 'TV', 'NF'],
    NZD: ['NZ', 'CK', 'NU', 'PN'],
    CAD: ['CA'],
    MXN: ['MX'],
    BRL: ['BR'],
    ZAR: ['ZA', 'LS', 'NA', 'SZ']
};

const NAMES = {
    EUR: 'euro', USD: 'US dollar', GBP: 'pound sterling', CHF: 'Swiss franc', DKK: 'Danish krone', NOK: 'Norwegian krone',
    SEK: 'Swedish krona', ISK: 'Icelandic króna', CZK: 'Czech koruna', HUF: 'Hungarian forint', PLN: 'Polish złoty', RON: 'Romanian leu',
    TRY: 'Turkish lira', JPY: 'Japanese yen', CNY: 'Chinese yuan', HKD: 'Hong Kong dollar', KRW: 'South Korean won', INR: 'Indian rupee',
    IDR: 'Indonesian rupiah', MYR: 'Malaysian ringgit', PHP: 'Philippine peso', SGD: 'Singapore dollar', THB: 'Thai baht',
    ILS: 'Israeli shekel', AUD: 'Australian dollar', NZD: 'New Zealand dollar', CAD: 'Canadian dollar', MXN: 'Mexican peso',
    BRL: 'Brazilian real', ZAR: 'South African rand', BGN: 'Bulgarian lev'
};

/** Two-letter country code -> currency code, for the currencies above. */
const CURRENCY_OF = {};
for (const [code, list] of Object.entries(USERS)) for (const cc of list) CURRENCY_OF[cc] = code;

module.exports = { CURRENCY_OF, NAMES };
