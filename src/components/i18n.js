import React, { createContext, useContext, useMemo } from 'react'

const dictionaries = {
  en: {
    brand: { marketplace: 'Marketplace' },
    nav: { home: 'Home', sell: 'Sell', jobs: 'Jobs', myAds: 'My Ads', account: 'Account' },
    notifications: { title: 'Notifications', close: 'Close', markAllRead: 'Mark all read', new: 'New' },
    footer: { policy: 'Service Policy', copyright: year => `© ${year} Ganudenu Marketplace` },
    home: {
      heroTitle: 'Buy • Sell • Hire',
      heroSubtitle: 'Discover great deals on vehicles, property, jobs, electronics, mobiles, and home & garden.',
      searchPlaceholder: 'Search anything (e.g., Toyota, House in Kandy, Accountant)...',
      searchButton: 'Search',
      filters: 'Filters',
      hideFilters: 'Hide Filters',
      latestListings: 'Latest listings',
      categoryListings: cat => `${cat} listings`
    },
    common: { language: 'Language' }
  },
  si: {
    brand: { marketplace: 'වෙළඳසැල' },
    nav: { home: 'මුල් පිටුව', sell: 'විකින්න', jobs: 'සේවා', myAds: 'මගේ දැන්වීම්', account: 'ගිණුම' },
    notifications: { title: 'දැනුම්දීම්', close: 'වසන්න', markAllRead: 'සියල්ල කියවූ ලෙස සැකසන්න', new: 'නව' },
    footer: { policy: 'සේවා ප්‍රතිපත්තිය', copyright: year => `© ${year} Ganudenu වෙළඳසැල` },
    home: {
      heroTitle: 'ගන්න • විකින්න • රැකියා',
      heroSubtitle: 'වాహන, දේපළ, රැකියා, ඉලෙක්ට්‍රොනික, ජංගම දුරකථන සහ නිවස & උද්යානය සඳහා වට්ටම් සොයන්න.',
      searchPlaceholder: 'කිසිවක් සොයන්න (උදා: ටයොටා, මහනුවර නිවසක්, ගණකකරු)...',
      searchButton: 'සෙවීම',
      filters: 'පෙරණ',
      hideFilters: 'පෙරණ සඟවන්න',
      latestListings: 'නවතම දැන්වීම්',
      categoryListings: cat => `${cat} දැන්වීම්`
    },
    common: { language: 'භාෂාව' }
  },
  ta: {
    brand: { marketplace: 'மார்க்கெட்' },
    nav: { home: 'முகப்பு', sell: 'விற்பனை', jobs: 'வேலைகள்', myAds: 'என் விளம்பரங்கள்', account: 'கணக்கு' },
    notifications: { title: 'அறிவிப்புகள்', close: 'மூடு', markAllRead: 'அனைத்தையும் படித்ததாக குறி', new: 'புது' },
    footer: { policy: 'சேவை கொள்கை', copyright: year => `© ${year} Ganudenu மார்க்கெட்` },
    home: {
      heroTitle: 'கொள் • வில் • வேலை',
      heroSubtitle: 'வாகனங்கள், சொத்து, வேலைகள், எலக்ட்ரானிக்ஸ், மொபைல்கள் மற்றும் வீடு & தோட்டத்தில் சிறந்த சலுகைகள்.',
      searchPlaceholder: 'ஏதாவது தேடு (எ.கா., டொயோட்டா, கண்டியில் வீடு, கணக்காளர்)...',
      searchButton: 'தேடு',
      filters: 'வடிகட்டிகள்',
      hideFilters: 'வடிகட்டிகள் மறை',
      latestListings: 'சமீபத்திய பட்டியல்கள்',
      categoryListings: cat => `${cat} பட்டியல்கள்`
    },
    common: { language: 'மொழி' }
  }
}

const I18nContext = createContext({ lang: 'en', t: (path, params) => path })

export function I18nProvider({ lang = 'en', children }) {
  const dict = dictionaries[lang] || dictionaries.en
  const t = useMemo(() => {
    return (path, params) => {
      try {
        const parts = String(path).split('.')
        let cur = dict
        for (const p of parts) {
          if (cur && typeof cur[p] !== 'undefined') cur = cur[p]
          else { cur = null; break }
        }
        if (cur == null) return path
        if (typeof cur === 'function') return cur(params)
        return String(cur)
      } catch (_) {
        return path
      }
    }
  }, [dict])
  return <I18nContext.Provider value={{ lang, t }}>{children}</I18nContext.Provider>
}

export function useI18n() {
  return useContext(I18nContext)
}