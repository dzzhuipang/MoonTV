/* eslint-disable @typescript-eslint/no-explicit-any, no-console, @typescript-eslint/no-non-null-assertion */

import { getStorage } from '@/lib/db';
import { AdminConfig } from './admin.types';
import runtimeConfig from './runtime';

export interface ApiSite {
  key: string;
  api: string;
  name: string;
  detail?: string;
}

interface ConfigFileStruct {
  cache_time?: number;
  api_site: {
    [key: string]: ApiSite;
  };
  custom_category?: {
    name?: string;
    type: 'movie' | 'tv';
    query: string;
  }[];
}

export const API_CONFIG = {
  search: {
    path: '?ac=videolist&wd=',
    pagePath: '?ac=videolist&wd={query}&pg={page}',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  },
  detail: {
    path: '?ac=videolist&ids=',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  },
};

// 在模块加载时根据环境决定配置来源
let fileConfig: ConfigFileStruct;
let cachedConfig: AdminConfig;

async function initConfig() {
  if (cachedConfig) {
    return;
  }

  if (process.env.DOCKER_ENV === 'true') {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const _require = eval('require') as NodeRequire;
    const fs = _require('fs') as typeof import('fs');
    const path = _require('path') as typeof import('path');

    const configPath = path.join(process.cwd(), 'config.json');
    const raw = fs.readFileSync(configPath, 'utf-8');
    fileConfig = JSON.parse(raw) as ConfigFileStruct;
    console.log('load dynamic config success');
  } else {
    // 默认使用编译时生成的配置
    fileConfig = runtimeConfig as unknown as ConfigFileStruct;
  }

  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';

  if (storageType !== 'localstorage') {
    // 数据库存储模式...
    const storage = getStorage();
    try {
      let adminConfig: AdminConfig | null = null;
      if (storage && typeof (storage as any).getAdminConfig === 'function') {
        adminConfig = await (storage as any).getAdminConfig();
      }

      let userNames: string[] = [];
      if (storage && typeof (storage as any).getAllUsers === 'function') {
        try {
          userNames = await (storage as any).getAllUsers();
        } catch (e) {
          console.error('获取用户列表失败:', e);
        }
      }

      const apiSiteEntries = Object.entries(fileConfig.api_site);
      const customCategories = fileConfig.custom_category || [];

      if (adminConfig) {
        // ...（中间逻辑保持不变）
        const sourceConfigMap = new Map(
          (adminConfig.SourceConfig || []).map((s) => [s.key, s])
        );

        apiSiteEntries.forEach(([key, site]) => {
          sourceConfigMap.set(key, {
            key,
            name: site.name,
            api: site.api,
            detail: site.detail,
            from: 'config',
            disabled: false,
          });
        });

        adminConfig.SourceConfig = Array.from(sourceConfigMap.values());

        const apiSiteKeys = new Set(apiSiteEntries.map(([key]) => key));
        adminConfig.SourceConfig.forEach((source) => {
          if (!apiSiteKeys.has(source.key)) {
            source.from = 'custom';
          }
        });

        if (!adminConfig.CustomCategories) {
          adminConfig.CustomCategories = [];
        }

        const customCategoriesMap = new Map(
          adminConfig.CustomCategories.map((c) => [c.query + c.type, c])
        );

        customCategories.forEach((category) => {
          customCategoriesMap.set(category.query + category.type, {
            name: category.name,
            type: category.type,
            query: category.query,
            from: 'config',
            disabled: false,
          });
        });

        const customCategoriesKeys = new Set(
          customCategories.map((c) => c.query + c.type)
        );
        customCategoriesMap.forEach((category) => {
          if (!customCategoriesKeys.has(category.query + category.type)) {
            category.from = 'custom';
          }
        });

        adminConfig.CustomCategories = Array.from(customCategoriesMap.values());

        const existedUsers = new Set(
          (adminConfig.UserConfig.Users || []).map((u) => u.username)
        );
        userNames.forEach((uname) => {
          if (!existedUsers.has(uname)) {
            adminConfig!.UserConfig.Users.push({
              username: uname,
              role: 'user',
            });
          }
        });

        const ownerUser = process.env.USERNAME;
        if (ownerUser) {
          adminConfig!.UserConfig.Users = adminConfig!.UserConfig.Users.filter(
            (u) => u.username !== ownerUser
          );
          adminConfig!.UserConfig.Users.unshift({
            username: ownerUser,
            role: 'owner',
          });
        }
      } else {
        // 创建新配置
        let allUsers = userNames.map((uname) => ({
          username: uname,
          role: 'user',
        }));
        const ownerUser = process.env.USERNAME;
        if (ownerUser) {
          allUsers = allUsers.filter((u) => u.username !== ownerUser);
          allUsers.unshift({ username: ownerUser, role: 'owner' });
        }

        adminConfig = {
          SiteConfig: {
            SiteName: process.env.SITE_NAME || 'MoonTV',
            Announcement: process.env.ANNOUNCEMENT || '本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。',
            SearchDownstreamMaxPage: Number(process.env.NEXT_PUBLIC_SEARCH_MAX_PAGE) || 5,
            SiteInterfaceCacheTime: fileConfig.cache_time || 7200,
            ImageProxy: process.env.NEXT_PUBLIC_IMAGE_PROXY || '',           // ← 已修改
            DoubanProxy: process.env.NEXT_PUBLIC_DOUBAN_PROXY || '',
            DisableYellowFilter: process.env.NEXT_PUBLIC_DISABLE_YELLOW_FILTER === 'true',
          },
          UserConfig: {
            AllowRegister: process.env.NEXT_PUBLIC_ENABLE_REGISTER === 'true',
            Users: allUsers as any,
          },
          SourceConfig: apiSiteEntries.map(([key, site]) => ({
            key,
            name: site.name,
            api: site.api,
            detail: site.detail,
            from: 'config',
            disabled: false,
          })),
          CustomCategories: customCategories.map((category) => ({
            name: category.name,
            type: category.type,
            query: category.query,
            from: 'config',
            disabled: false,
          })),
        };
      }

      if (storage && typeof (storage as any).setAdminConfig === 'function') {
        await (storage as any).setAdminConfig(adminConfig);
      }

      cachedConfig = adminConfig;
    } catch (err) {
      console.error('加载管理员配置失败:', err);
    }
  } else {
    // 本地存储（Cloudflare Pages 使用此分支）
    cachedConfig = {
      SiteConfig: {
        SiteName: process.env.SITE_NAME || 'MoonTV',
        Announcement: process.env.ANNOUNCEMENT || '本网站仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。',
        SearchDownstreamMaxPage: Number(process.env.NEXT_PUBLIC_SEARCH_MAX_PAGE) || 5,
        SiteInterfaceCacheTime: fileConfig.cache_time || 7200,
        ImageProxy: process.env.NEXT_PUBLIC_IMAGE_PROXY || '',              // ← 已修改
        DoubanProxy: process.env.NEXT_PUBLIC_DOUBAN_PROXY || '',
        DisableYellowFilter: process.env.NEXT_PUBLIC_DISABLE_YELLOW_FILTER === 'true',
      },
      UserConfig: {
        AllowRegister: process.env.NEXT_PUBLIC_ENABLE_REGISTER === 'true',
        Users: [],
      },
      SourceConfig: Object.entries(fileConfig.api_site).map(([key, site]) => ({
        key,
        name: site.name,
        api: site.api,
        detail: site.detail,
        from: 'config',
        disabled: false,
      })),
      CustomCategories: fileConfig.custom_category?.map((category) => ({
        name: category.name,
        type: category.type,
        query: category.query,
        from: 'config',
        disabled: false,
      })) || [],
    } as AdminConfig;
  }
}

export async function getConfig(): Promise<AdminConfig> {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (process.env.DOCKER_ENV === 'true' || storageType === 'localstorage') {
    await initConfig();
    return cachedConfig;
  }

  // DB 存储模式（非 Cloudflare Pages）
  const storage = getStorage();
  let adminConfig: AdminConfig | null = null;
  if (storage && typeof (storage as any).getAdminConfig === 'function') {
    adminConfig = await (storage as any).getAdminConfig();
  }

  if (adminConfig) {
    // 合并环境变量
    adminConfig.SiteConfig.SiteName = process.env.SITE_NAME || 'MoonTV';
    adminConfig.SiteConfig.Announcement = process.env.ANNOUNCEMENT || '...';
    adminConfig.UserConfig.AllowRegister = process.env.NEXT_PUBLIC_ENABLE_REGISTER === 'true';
    adminConfig.SiteConfig.ImageProxy = process.env.NEXT_PUBLIC_IMAGE_PROXY || '';   // ← 已修改
    adminConfig.SiteConfig.DoubanProxy = process.env.NEXT_PUBLIC_DOUBAN_PROXY || '';
    adminConfig.SiteConfig.DisableYellowFilter = process.env.NEXT_PUBLIC_DISABLE_YELLOW_FILTER === 'true';

    // ... 其余代码保持不变
    fileConfig = runtimeConfig as unknown as ConfigFileStruct;
    const apiSiteEntries = Object.entries(fileConfig.api_site);
    const sourceConfigMap = new Map((adminConfig.SourceConfig || []).map((s) => [s.key, s]));

    // （中间的 source 和 category 合并逻辑保持原样）
    apiSiteEntries.forEach(([key, site]) => {
      const existingSource = sourceConfigMap.get(key);
      if (existingSource) {
        existingSource.name = site.name;
        existingSource.api = site.api;
        existingSource.detail = site.detail;
        existingSource.from = 'config';
      } else {
        sourceConfigMap.set(key, { key, name: site.name, api: site.api, detail: site.detail, from: 'config', disabled: false });
      }
    });

    adminConfig.SourceConfig = Array.from(sourceConfigMap.values());

    const customCategories = fileConfig.custom_category || [];
    adminConfig.CustomCategories = customCategories.map((category) => ({
      name: category.name,
      type: category.type,
      query: category.query,
      from: 'config',
      disabled: false,
    }));

    // owner 处理...
    const ownerUser = process.env.USERNAME || '';
    let containOwner = false;
    adminConfig.UserConfig.Users.forEach((user) => {
      if (user.username !== ownerUser && user.role === 'owner') user.role = 'user';
      if (user.username === ownerUser) {
        containOwner = true;
        user.role = 'owner';
      }
    });
    if (!containOwner) {
      adminConfig.UserConfig.Users.unshift({ username: ownerUser, role: 'owner' });
    }

    cachedConfig = adminConfig;
  } else {
    await initConfig();
  }
  return cachedConfig;
}

// resetConfig 函数也同步修改（省略部分重复代码，核心修改已标出）
export async function resetConfig() {
  // ...（前面部分不变）
  const adminConfig = {
    SiteConfig: {
      SiteName: process.env.SITE_NAME || 'MoonTV',
      Announcement: process.env.ANNOUNCEMENT || '...',
      SearchDownstreamMaxPage: Number(process.env.NEXT_PUBLIC_SEARCH_MAX_PAGE) || 5,
      SiteInterfaceCacheTime: fileConfig.cache_time || 7200,
      ImageProxy: process.env.NEXT_PUBLIC_IMAGE_PROXY || '',                    // ← 已修改
      DoubanProxy: process.env.NEXT_PUBLIC_DOUBAN_PROXY || '',
      DisableYellowFilter: process.env.NEXT_PUBLIC_DISABLE_YELLOW_FILTER === 'true',
    },
    // ... 其余保持不变
  } as AdminConfig;

  // ... 后面代码不变
}

export async function getCacheTime(): Promise<number> {
  const config = await getConfig();
  return config.SiteConfig.SiteInterfaceCacheTime || 7200;
}

export async function getAvailableApiSites(): Promise<ApiSite[]> {
  const config = await getConfig();
  return config.SourceConfig.filter((s) => !s.disabled).map((s) => ({
    key: s.key,
    name: s.name,
    api: s.api,
    detail: s.detail,
  }));
}
